/**
 * Replays both strategies over the same pool history and reports which won.
 *
 * Resident's method is built on δ ≥ 25% dislocations. Operator data from a
 * comparable desk suggests routine deviation is low single digits and the money
 * is fee capture. This settles it per pool, on real history, rather than by
 * argument: the same capital, the same window, both strategies.
 */

import {
  divergenceLoss,
  inRange,
  liquidityForCapital,
  openBand,
  type Band,
} from "./band.ts";
import type { PoolHistory } from "./history.ts";
import {
  DEFAULT_ENTRY_CONFIG,
  DEFAULT_EXIT_CONFIG,
  bandWidth,
  concentratedShare,
  evaluateEntry,
  realisedVolatility,
  type EntryConfig,
  type ExitConfig,
} from "./strategy.ts";

/**
 * Sell `dx` of token0 into a single range of liquidity L at price p.
 *
 * From the v3 identity dx = L(1/√p' − 1/√p), so √p' = 1/(1/√p + dx/L), and the
 * quote received is L(√p − √p'). The fee is taken off the input, as the pool
 * does.
 */
export function sellInto(
  liquidity: number,
  price: number,
  dx: number,
  feePips: number,
): { out: number; effectivePrice: number; priceAfter: number } {
  if (liquidity <= 0 || dx <= 0) return { out: 0, effectivePrice: 0, priceAfter: price };

  const dxAfterFee = dx * (1 - feePips / 1_000_000);
  const sqrtP = Math.sqrt(price);
  const sqrtNext = 1 / (1 / sqrtP + dxAfterFee / liquidity);
  const out = liquidity * (sqrtP - sqrtNext);

  return { out, effectivePrice: out / dx, priceAfter: sqrtNext * sqrtNext };
}

export type BandConfig = {
  capital: number;
  halfWidth: number;
  /** Intervals out of range before the band is re-centred. */
  rebalanceAfter: number;
  /**
   * Retire the position if it falls this far below capital.
   *
   * Live positions on comparable pools run stops near 35%, with the occasional
   * outlier at 70%, so the default here is 0.35. An earlier 0.05 was arbitrary
   * and would have retired every one of those positions almost immediately — a stop that tight turns a strategy whose whole thesis is
   * "eat the bleed, out-earn it in fees" into one that never gets paid.
   */
  stopLossFraction: number;
  /**
   * Fraction of the naive fee estimate a band actually captures.
   *
   * volume × fee × share is an UPPER BOUND, not an estimate. It assumes every
   * unit of reported pool flow transacts through this band's own range, at the
   * band's full share. Neither holds: a pool's flow includes trades at prices
   * the band does not cover, and in concentrated liquidity only the active tick
   * earns.
   *
   * Measured against live positions on comparable pools: one at 13.3% share
   * against $1.25M/h of flow at a 2% fee earned $481/h, where the naive figure
   * is $3,325/h — a capture of 14.5%. Another at 89.1% share of a $10.6k/h pool
   * matched its naive figure almost exactly, because at that share nearly all
   * flow does cross the band.
   *
   * So capture falls as share falls. Two observations is not a curve, which is
   * why this defaults to 1.0: the model states its upper bound honestly rather
   * than fitting a factor to two points. Set it from your own fills.
   */
  captureEfficiency: number;
  /**
   * Fraction of allocated capital that actually reaches the pool.
   *
   * A two-sided band can only deploy what the token ratio at the current price
   * allows; the rest sits idle. Observed across live two-sided positions:
   * $9,471 of $12,000, $4,825 of $6,000,
   * $5,516 of $6,000, $5,218 of $6,000, $5,258 of $6,000, and $9,000 of
   * $20,000 — a median near 85%, and as low as 45%. Fees accrue on what is
   * deployed, but the return is measured against what was committed.
   */
  deployedFraction: number;
};

export const DEFAULT_BAND_CONFIG: BandConfig = {
  capital: 10_000,
  halfWidth: 0.05,
  rebalanceAfter: 5,
  stopLossFraction: 0.35,
  captureEfficiency: 1,
  deployedFraction: 0.85,
};

export type BandResult = {
  strategy: "band";
  feesEarned: number;
  divergenceLoss: number;
  /** Fees less divergence loss. The figure that actually matters. */
  net: number;
  netReturn: number;
  rebalances: number;
  intervalsInRange: number;
  intervalsTotal: number;
  timeInRange: number;
  retired: boolean;
  retiredAt: number | null;
};

/** Replay a two-sided band, re-centring when it drifts out and retiring on a stop. */
export function backtestBand(
  history: PoolHistory,
  config: BandConfig = DEFAULT_BAND_CONFIG,
): BandResult {
  const { candles, feePips } = history;
  if (!candles.length) throw new Error("no candles");

  const deployed = config.capital * config.deployedFraction;
  let band: Band = openBand(candles[0].price, config.halfWidth, deployed);
  let fees = 0;
  let realisedLoss = 0;
  let outOfRangeRun = 0;
  let rebalances = 0;
  let inRangeCount = 0;
  let retiredAt: number | null = null;

  for (const c of candles) {
    if (retiredAt !== null) break;

    if (inRange(band, c.price)) {
      inRangeCount++;
      outOfRangeRun = 0;
      // The band competes with everything else in range for the flow.
      const share = deployed / (deployed + c.liquidity);
      fees += c.volume * (feePips / 1_000_000) * share * config.captureEfficiency;
    } else {
      outOfRangeRun++;
    }

    const loss = divergenceLoss(band, c.price) * band.capital;
    // Net of fees already banked, not a gross drawdown on the mark.
    const equity = config.capital + fees + loss - realisedLoss;

    if (equity < config.capital * (1 - config.stopLossFraction)) {
      realisedLoss += -loss;
      retiredAt = c.t;
      break;
    }

    if (outOfRangeRun >= config.rebalanceAfter) {
      // Close, book the loss, re-open around the new price.
      realisedLoss += -loss;
      band = openBand(c.price, config.halfWidth, deployed);
      rebalances++;
      outOfRangeRun = 0;
    }
  }

  const last = candles[candles.length - 1];
  const openLoss = retiredAt === null ? -divergenceLoss(band, last.price) * band.capital : 0;
  const totalLoss = realisedLoss + openLoss;

  return {
    strategy: "band",
    feesEarned: fees,
    divergenceLoss: totalLoss,
    net: fees - totalLoss,
    netReturn: (fees - totalLoss) / config.capital,
    rebalances,
    intervalsInRange: inRangeCount,
    intervalsTotal: candles.length,
    timeInRange: inRangeCount / candles.length,
    retired: retiredAt !== null,
    retiredAt,
  };
}

export type DislocationConfig = {
  /** Inventory cap in quote units — κ. */
  capital: number;
  /** δ* */
  minDeviation: number;
  /** θ, added when the primary session is closed. */
  sessionPremium: number;
  /** ε, the execution edge over reference. */
  executionEdge: number;
  /** τ, the tranche fraction. */
  trancheFraction: number;
  /** Minimum profit per order — π_min. */
  minProfit: number;
  /** Minimum sellable depth above the floor. */
  minDepth: number;
  /** Intervals between orders on one instrument — Δt. */
  cooldownIntervals: number;
};

export const DEFAULT_DISLOCATION_CONFIG: DislocationConfig = {
  capital: 10_000,
  minDeviation: 0.25,
  sessionPremium: 0.1,
  executionEdge: 0.05,
  trancheFraction: 0.2,
  minProfit: 2,
  minDepth: 100,
  cooldownIntervals: 2,
};

export type DislocationEvent = {
  t: number;
  deviation: number;
  sold: number;
  proceeds: number;
  profit: number;
};

export type DislocationResult = {
  strategy: "dislocation";
  /** Intervals where δ crossed the threshold at all. */
  qualifyingIntervals: number;
  /** Distinct episodes — consecutive qualifying intervals count once. */
  episodes: number;
  /** Longest run of consecutive qualifying intervals. */
  longestEpisode: number;
  /** Orders actually executed after every gate. */
  orders: number;
  realisedProfit: number;
  netReturn: number;
  /** Inventory left at the end, marked at the closing reference. */
  inventoryRemaining: number;
  events: DislocationEvent[];
};

/**
 * Replay the dislocation desk: hold inventory, sell tranches into verified
 * spikes above the floor, never below basis.
 */
export function backtestDislocation(
  history: PoolHistory,
  config: DislocationConfig = DEFAULT_DISLOCATION_CONFIG,
): DislocationResult {
  const { candles, feePips } = history;
  if (!candles.length) throw new Error("no candles");

  const first = candles[0];
  const basis = first.reference ?? first.price;
  // Capital is deployed as inventory at the opening reference.
  let inventory = config.capital / basis;

  let realised = 0;
  let qualifying = 0;
  let episodes = 0;
  let longest = 0;
  let run = 0;
  let cooldown = 0;
  const events: DislocationEvent[] = [];

  for (const c of candles) {
    if (cooldown > 0) cooldown--;

    const reference = c.reference;
    // Outside the session the reference is stale, so the threshold widens.
    const threshold =
      config.minDeviation + (reference === null ? config.sessionPremium : 0);
    const mark = reference ?? basis;
    const deviation = (c.price - mark) / mark;

    if (deviation < threshold) {
      if (run > 0) {
        episodes++;
        longest = Math.max(longest, run);
        run = 0;
      }
      continue;
    }

    qualifying++;
    run++;
    if (cooldown > 0 || inventory <= 0) continue;

    const floor = Math.max(mark * (1 + config.executionEdge), basis);
    const liquidity = liquidityForCapital(
      c.liquidity,
      c.price * 0.95,
      c.price * 1.05,
      c.price,
    );

    // Largest tranche whose effective price still clears the floor.
    const size = inventory * config.trancheFraction;
    const quote = sellInto(liquidity, c.price, size, feePips);
    if (quote.effectivePrice < floor) continue;
    if (quote.out < config.minDepth) continue;

    const profit = quote.out - size * Math.max(mark, basis);
    if (profit < config.minProfit) continue;

    inventory -= size;
    realised += profit;
    cooldown = config.cooldownIntervals;
    events.push({ t: c.t, deviation, sold: size, proceeds: quote.out, profit });
  }

  if (run > 0) {
    episodes++;
    longest = Math.max(longest, run);
  }

  const last = candles[candles.length - 1];
  const closingMark = last.reference ?? last.price;

  return {
    strategy: "dislocation",
    qualifyingIntervals: qualifying,
    episodes,
    longestEpisode: longest,
    orders: events.length,
    realisedProfit: realised,
    netReturn: realised / config.capital,
    inventoryRemaining: inventory * closingMark,
    events,
  };
}

export type Comparison = {
  pool: string;
  pair: string;
  intervals: number;
  days: number;
  band: BandResult;
  dislocation: DislocationResult;
  winner: "band" | "dislocation" | "neither";
  /** Largest deviation seen, which is what δ* has to be set against. */
  maxDeviation: number;
  medianDeviation: number;
};

export function compare(
  history: PoolHistory,
  bandConfig: BandConfig = DEFAULT_BAND_CONFIG,
  dislocationConfig: DislocationConfig = DEFAULT_DISLOCATION_CONFIG,
): Comparison {
  const band = backtestBand(history, bandConfig);
  const dislocation = backtestDislocation(history, dislocationConfig);

  const deviations = history.candles
    .map((c) => {
      const mark = c.reference;
      return mark === null ? null : (c.price - mark) / mark;
    })
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);

  const winner =
    band.net <= 0 && dislocation.realisedProfit <= 0
      ? "neither"
      : band.net >= dislocation.realisedProfit
        ? "band"
        : "dislocation";

  return {
    pool: history.pool,
    pair: history.pair,
    intervals: history.candles.length,
    days: (history.candles.length * history.intervalMs) / 86_400_000,
    band,
    dislocation,
    winner,
    maxDeviation: deviations.length ? deviations[deviations.length - 1] : 0,
    medianDeviation: deviations.length ? deviations[Math.floor(deviations.length / 2)] : 0,
  };
}


// ---------------------------------------------------------------------------
// Managed band: the same market, played on policy rather than on constants.
// ---------------------------------------------------------------------------

export type ManagedConfig = {
  capital: number;
  captureEfficiency: number;
  deployedFraction: number;
  entry: EntryConfig;
  exit: ExitConfig;
  /** Intervals of history needed before the vol estimate is usable. */
  warmup: number;
};

export const DEFAULT_MANAGED_CONFIG: ManagedConfig = {
  capital: 10_000,
  captureEfficiency: 1,
  deployedFraction: 0.85,
  entry: DEFAULT_ENTRY_CONFIG,
  exit: DEFAULT_EXIT_CONFIG,
  warmup: 60,
};

export type ManagedResult = {
  strategy: "managed";
  feesEarned: number;
  divergenceLoss: number;
  net: number;
  netReturn: number;
  rebalances: number;
  /** Intervals holding a position at all. */
  intervalsDeployed: number;
  intervalsTotal: number;
  /** Of the intervals deployed, the share spent in range. */
  timeInRange: number;
  /** Times the policy declined to hold because the bleed swamped the fees. */
  standDowns: number;
  retired: boolean;
  /** Widths actually chosen, for inspection. */
  medianWidth: number;
};

/**
 * Replay the managed policy.
 *
 * Differences from {@link backtestBand}, each traceable to something the fixed
 * version gets wrong:
 *
 *   - width tracks realised volatility instead of a constant;
 *   - the desk sits out while expected bleed exceeds expected fees, rather than
 *     always holding;
 *   - the stop is on net rather than gross.
 */
export function backtestManaged(
  history: PoolHistory,
  config: ManagedConfig = DEFAULT_MANAGED_CONFIG,
): ManagedResult {
  const { candles, feePips } = history;
  if (!candles.length) throw new Error("no candles");

  const deployed = config.capital * config.deployedFraction;
  let band: Band | null = null;
  let fees = 0;
  let realisedLoss = 0;
  let outOfRangeRun = 0;
  let rebalances = 0;
  let deployedIntervals = 0;
  let inRangeIntervals = 0;
  let standDowns = 0;
  let retired = false;
  const widths: number[] = [];

  const prices: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    prices.push(c.price);
    if (retired) break;
    if (i < config.warmup) continue;

    const vol = realisedVolatility(prices, config.entry.width.horizon);
    const verdict = evaluateEntry(
      {
        volume: c.volume,
        liquidity: c.liquidity,
        feePips,
        volatility: vol,
        deployed,
        captureEfficiency: config.captureEfficiency,
      },
      config.entry,
    );

    if (!band) {
      // Only take the position when the policy says it pays.
      if (!verdict.enter) {
        standDowns++;
        continue;
      }
      band = openBand(c.price, verdict.halfWidth, deployed);
      widths.push(verdict.halfWidth);
      outOfRangeRun = 0;
    }

    deployedIntervals++;

    if (inRange(band, c.price)) {
      inRangeIntervals++;
      outOfRangeRun = 0;
      const share = concentratedShare(
        deployed,
        (band.upper - band.lower) / 2 / c.price,
        c.liquidity,
      );
      fees += c.volume * (feePips / 1_000_000) * share * config.captureEfficiency;
    } else {
      outOfRangeRun++;
    }

    const openLoss = -divergenceLoss(band, c.price) * band.capital;
    // Net, not gross: fees already banked count against the loss.
    const net = fees - realisedLoss - openLoss;

    if (net < -config.capital * config.exit.maxNetLossFraction) {
      realisedLoss += openLoss;
      retired = true;
      break;
    }

    if (!verdict.enter) {
      // The pool stopped paying for the risk; step out and wait.
      realisedLoss += openLoss;
      band = null;
      standDowns++;
      continue;
    }

    if (outOfRangeRun >= config.exit.rebalanceAfter) {
      realisedLoss += openLoss;
      const width = bandWidth(vol, config.entry.width);
      band = openBand(c.price, width, deployed);
      widths.push(width);
      rebalances++;
      outOfRangeRun = 0;
    }
  }

  const last = candles[candles.length - 1];
  const openLoss = band && !retired ? -divergenceLoss(band, last.price) * band.capital : 0;
  const totalLoss = realisedLoss + openLoss;

  const sorted = [...widths].sort((a, b) => a - b);
  return {
    strategy: "managed",
    feesEarned: fees,
    divergenceLoss: totalLoss,
    net: fees - totalLoss,
    netReturn: (fees - totalLoss) / config.capital,
    rebalances,
    intervalsDeployed: deployedIntervals,
    intervalsTotal: candles.length,
    timeInRange: deployedIntervals ? inRangeIntervals / deployedIntervals : 0,
    standDowns,
    retired,
    medianWidth: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
  };
}
