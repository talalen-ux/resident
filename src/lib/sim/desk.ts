/**
 * The desk's decision functions, evaluated against pool state.
 *
 * Each is computed through the pool's own swap math rather than from displayed
 * price — which is the whole point of the fillability test.
 */

import { spotPrice, swapExactIn, type PoolState } from "./v3.ts";

/** Operating parameters, as published. */
export type Params = {
  /** δ* — minimum actionable deviation. */
  minDeviation: number;
  /** θ — closed-session threshold widening. */
  sessionPremium: number;
  /** q₀ — fillability probe notional, in quote units. */
  probeNotional: number;
  /** φ_min — minimum probe yield, in quote units. */
  probeMinYield: number;
  /** d_min — sellable depth above the floor, in quote units. */
  minDepth: number;
  /** ε — execution edge over reference. */
  executionEdge: number;
  /** π_min — minimum absolute profit per order, in quote units. */
  minProfit: number;
  /** τ — maximum fraction of S* per order. */
  trancheFraction: number;
  /** Parking band: deviations outside this are structural artifacts. */
  parkingBand: { low: number; high: number };
};

export const DEFAULT_PARAMS: Params = {
  minDeviation: 0.25,
  sessionPremium: 0.1,
  probeNotional: 50,
  probeMinYield: 25,
  minDepth: 100,
  executionEdge: 0.05,
  minProfit: 2,
  trancheFraction: 0.2,
  parkingBand: { low: -0.95, high: 50 },
};

const toUnits = (human: number, decimals: number) =>
  BigInt(Math.round(human * 10 ** decimals));

const fromUnits = (raw: bigint, decimals: number) =>
  Number(raw) / 10 ** decimals;

/** §2 — instantaneous deviation of a pool from the reference price. */
export function deviation(pool: PoolState, reference: number): number {
  return (spotPrice(pool) - reference) / reference;
}

/** A deviation outside the parking band is a pool initialised at a boundary. */
export function isStructuralArtifact(dev: number, p = DEFAULT_PARAMS): boolean {
  return dev < p.parkingBand.low || dev > p.parkingBand.high;
}

export type ProbeResult = {
  /** Φ — quote-token proceeds from liquidating q₀/P̂ of the stock. */
  yield: number;
  /** True when the probe filled at all. */
  filled: boolean;
  passed: boolean;
  ticksCrossed: number;
};

/**
 * §3 — the fillability probe.
 *
 * Quotes a liquidation of a fixed notional through the pool's own math. A
 * genuine pump deposited the aggressor's quote asset into the pool, so it is
 * always fillable; a mirage quotes nothing.
 */
export function fillabilityProbe(
  pool: PoolState,
  reference: number,
  p = DEFAULT_PARAMS,
): ProbeResult {
  const stockIn = toUnits(p.probeNotional / reference, pool.token0.decimals);
  const res = swapExactIn(pool, true, stockIn);
  const out = fromUnits(res.amountOut, pool.token1.decimals);
  return {
    yield: out,
    filled: res.amountOut > 0n,
    passed: out >= p.probeMinYield,
    ticksCrossed: res.ticksCrossed,
  };
}

/** Effective price paid by an aggression of `notionalUsd` through this pool. */
function effectiveBuyPrice(pool: PoolState, notionalUsd: number): number | null {
  const quoteIn = toUnits(notionalUsd, pool.token1.decimals);
  const res = swapExactIn(pool, false, quoteIn);
  if (res.amountOut === 0n) return null;
  const stockOut = fromUnits(res.amountOut, pool.token0.decimals);
  return notionalUsd / stockOut;
}

/**
 * §4 — impact function exactly as published: the premium over *reference* paid
 * by an aggression of increasing notional.
 *
 *   I(Q) = P_eff(Q) / P̂ − 1
 */
export function impact(pool: PoolState, reference: number, notionalUsd: number): number | null {
  const effective = effectiveBuyPrice(pool, notionalUsd);
  return effective === null ? null : effective / reference - 1;
}

/**
 * The same sweep measured against the pool's own mid rather than reference.
 *
 * This is what the daily survey actually wants. The published formula divides
 * by P̂, which folds any existing dislocation into the reading: a genuinely deep
 * instrument that happens to sit 28% above reference on survey day reports 28%
 * impact and is classified eligible, when nothing about its book is thin.
 * Dividing by spot isolates the property being measured — how far a given
 * notional walks this book — which is what "thinness is a state, not a
 * property" is about. {@link impact} keeps the published definition for
 * reporting; {@link classify} uses this one for the verdict.
 */
export function impactVsSpot(pool: PoolState, notionalUsd: number): number | null {
  const effective = effectiveBuyPrice(pool, notionalUsd);
  return effective === null ? null : effective / spotPrice(pool) - 1;
}

export type Classification = {
  impact1k: number | null;
  impact10k: number | null;
  classification:
    | "eligible"
    | "deep"
    | "unfillable"
    | "not-canonical"
    | "excluded-etf";
  reason: string;
};

export type SurveyOptions = {
  /**
   * Lowercased addresses the desk may take inventory in. When supplied, an
   * instrument whose token is not in the set is rejected outright.
   *
   * Pass `tradableAddresses()` from lib/chain: it holds the canonical stock
   * tokens and quote assets but deliberately omits the tokenized ETFs, which
   * the method excludes categorically.
   */
  canonical?: Set<string>;
  /**
   * Lowercased addresses of canonical tokenized ETFs. Supplying this only
   * changes the wording of the rejection — an ETF is refused either way — but it
   * separates "excluded by policy" from "not a real token", which are very
   * different things for an operator reading the board.
   */
  etfs?: Set<string>;
};

/**
 * §4 — daily survey verdict for one instrument.
 *
 * Reports impact against reference, as published, but classifies on impact
 * against spot — see {@link impactVsSpot} for why the two differ and why the
 * verdict uses the latter.
 */
export function classify(
  pool: PoolState,
  reference: number,
  opts: SurveyOptions = {},
): Classification {
  // Identity first. Robinhood's own docs warn that a token with a matching
  // name/ticker but a different contract address is not a Robinhood Stock
  // Token, and an impostor is precisely what this survey would otherwise wave
  // through: a fake ticker in a thin pool has exactly the thin book and wild
  // deviations the desk is built to hunt. The fillability probe cannot help —
  // it proves a pool can be sold into, not that the asset is real. So the
  // registry check runs before any depth measurement.
  if (opts.canonical) {
    const address = pool.token0.address?.toLowerCase();
    if (!address || !opts.canonical.has(address)) {
      const isEtf = address ? (opts.etfs?.has(address) ?? false) : false;
      return {
        impact1k: null,
        impact10k: null,
        classification: isEtf ? "excluded-etf" : "not-canonical",
        reason: isEtf
          ? "tokenized ETF — excluded from the program categorically"
          : address
            ? `${address} is not a canonical Robinhood Stock Token`
            : "token address unknown — cannot confirm it is canonical",
      };
    }
  }

  const i1k = impact(pool, reference, 1_000);
  const i10k = impact(pool, reference, 10_000);
  const thin1k = impactVsSpot(pool, 1_000);
  const thin10k = impactVsSpot(pool, 10_000);

  if (thin1k === null) {
    return { impact1k: null, impact10k: i10k, classification: "unfillable",
      reason: "a $1k order cannot fill at all" };
  }
  if (thin10k !== null && thin10k <= 0.0025) {
    return { impact1k: i1k, impact10k: i10k, classification: "deep",
      reason: `$10k moves price ${(thin10k * 100).toFixed(3)}% — arbitraged before inventory monetizes` };
  }
  if (thin1k > 0.005) {
    return { impact1k: i1k, impact10k: i10k, classification: "eligible",
      reason: `$1k moves price ${(thin1k * 100).toFixed(2)}%` };
  }
  return { impact1k: i1k, impact10k: i10k, classification: "deep",
    reason: `$1k moves price only ${(thin1k * 100).toFixed(3)}%` };
}

export type SizingResult = {
  /** S* — largest size whose effective price clears the floor. */
  maxSize: number;
  /** τ·S* — what this order actually sends. */
  trancheSize: number;
  /** Quote proceeds from the tranche. */
  proceeds: number;
  /** Effective price achieved on the tranche. */
  effectivePrice: number;
  /** Profit over max(reference value, basis). */
  profit: number;
  /** The binding floor. */
  floor: number;
  qualifies: boolean;
  reason: string;
};

/**
 * §6 — size the maximum liquidation clearing the profit floor, then take a
 * tranche of it.
 *
 * S* = max { S ≤ inventory : P_eff(S) ≥ max( P̂·(1+ε), B̄ ) }
 *
 * P_eff is monotonically decreasing in S — selling more moves price against you
 * — so the largest qualifying size is found by bisection rather than a scan.
 */
export function sizeLiquidation(
  pool: PoolState,
  reference: number,
  inventory: number,
  basis: number,
  p = DEFAULT_PARAMS,
): SizingResult {
  const floor = Math.max(reference * (1 + p.executionEdge), basis);

  const effectiveAt = (size: number): { price: number; proceeds: number } => {
    if (size <= 0) return { price: 0, proceeds: 0 };
    const res = swapExactIn(pool, true, toUnits(size, pool.token0.decimals));
    const out = fromUnits(res.amountOut, pool.token1.decimals);
    return { price: out / size, proceeds: out };
  };

  const fail = (reason: string): SizingResult => ({
    maxSize: 0, trancheSize: 0, proceeds: 0, effectivePrice: 0,
    profit: 0, floor, qualifies: false, reason,
  });

  // Nothing clears the floor even at an infinitesimal size: the pool is below it.
  const probe = effectiveAt(Math.min(inventory, inventory * 1e-6) || 0);
  if (probe.price < floor) {
    return fail(`marginal price ${probe.price.toFixed(4)} is under the floor ${floor.toFixed(4)}`);
  }

  let lo = 0;
  let hi = inventory;
  if (effectiveAt(hi).price >= floor) {
    lo = hi;
  } else {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (effectiveAt(mid).price >= floor) lo = mid;
      else hi = mid;
    }
  }

  const maxSize = lo;
  const trancheSize = maxSize * p.trancheFraction;
  const { price, proceeds } = effectiveAt(trancheSize);
  const profit = proceeds - trancheSize * Math.max(reference, basis);

  if (trancheSize <= 0) return fail("no size clears the floor");
  if (proceeds < p.minDepth) {
    return { maxSize, trancheSize, proceeds, effectivePrice: price, profit, floor,
      qualifies: false, reason: `sellable depth $${proceeds.toFixed(2)} is under d_min $${p.minDepth}` };
  }
  if (profit < p.minProfit) {
    return { maxSize, trancheSize, proceeds, effectivePrice: price, profit, floor,
      qualifies: false, reason: `profit $${profit.toFixed(2)} is under π_min $${p.minProfit}` };
  }

  return { maxSize, trancheSize, proceeds, effectivePrice: price, profit, floor,
    qualifies: true, reason: "clears every gate" };
}

export type Verdict = {
  symbol: string;
  deviation: number;
  spot: number;
  reference: number;
  probe: ProbeResult;
  sizing: SizingResult | null;
  actionable: boolean;
  blockedBy: string | null;
};

/** The full gate, in the order the desk applies it. */
export function evaluate(
  pool: PoolState,
  symbol: string,
  reference: number,
  inventory: number,
  basis: number,
  opts: {
    sessionOpen?: boolean;
    params?: Params;
    canonical?: Set<string>;
    etfs?: Set<string>;
  } = {},
): Verdict {
  const p = opts.params ?? DEFAULT_PARAMS;

  // An impostor token never reaches the deviation gate.
  if (opts.canonical) {
    const address = pool.token0.address?.toLowerCase();
    if (!address || !opts.canonical.has(address)) {
      return {
        symbol,
        deviation: deviation(pool, reference),
        spot: spotPrice(pool),
        reference,
        probe: { yield: 0, filled: false, passed: false, ticksCrossed: 0 },
        sizing: null,
        actionable: false,
        blockedBy:
          address && opts.etfs?.has(address)
            ? "tokenized ETF — excluded categorically"
            : "not a canonical Robinhood Stock Token",
      };
    }
  }
  const threshold = p.minDeviation + (opts.sessionOpen === false ? p.sessionPremium : 0);

  const dev = deviation(pool, reference);
  const spot = spotPrice(pool);
  const base = { symbol, deviation: dev, spot, reference };

  if (isStructuralArtifact(dev, p)) {
    return { ...base, probe: { yield: 0, filled: false, passed: false, ticksCrossed: 0 },
      sizing: null, actionable: false, blockedBy: "structural artifact — outside the parking band" };
  }

  if (dev < threshold) {
    return { ...base, probe: { yield: 0, filled: false, passed: false, ticksCrossed: 0 },
      sizing: null, actionable: false,
      blockedBy: `below δ* (${(threshold * 100).toFixed(0)}%)` };
  }

  const probe = fillabilityProbe(pool, reference, p);
  if (!probe.filled) {
    return { ...base, probe, sizing: null, actionable: false,
      blockedBy: "probe returned nothing — mirage" };
  }
  if (!probe.passed) {
    return { ...base, probe, sizing: null, actionable: false,
      blockedBy: `probe yield $${probe.yield.toFixed(2)} under φ_min` };
  }

  const sizing = sizeLiquidation(pool, reference, inventory, basis, p);
  return { ...base, probe, sizing, actionable: sizing.qualifies,
    blockedBy: sizing.qualifies ? null : sizing.reason };
}
