/**
 * Opportunity alerts: pools where a band of a given size would earn the most
 * right now.
 *
 * The estimate is what a band *would have faced* over each window, not what the
 * desk earned. It assumes the band sits in range for the whole window and takes
 * a constant share of flow, which is the optimistic case — a pool that moves out
 * of the band earns nothing while it is out. Read it as a ranking signal, not a
 * forecast.
 */

import { amount0Delta, amount1Delta, spotPrice, type PoolState } from "./v3.ts";

/** Trailing volume in quote units, per window. */
export type VolumeWindows = {
  m5: number;
  h1: number;
  h6: number;
  h24: number;
};

export type PoolObservation = {
  address: string;
  pool: PoolState;
  volume: VolumeWindows;
  /** Highest price seen in the last 24h, quote units. */
  peak24h: number;
  /** Pool age in minutes. */
  ageMinutes: number;
  /** True when the pool runs a v4 hook. Hooks can take the LP's fee. */
  hasHook: boolean;
  /** Net position count from the smart-LP tracker: winners minus losers. */
  smartLpNet: number;
  /** Smart wallets currently holding a position in this pool. */
  smartLpPresent: number;
  /** Smart wallets that left in the last hour. */
  smartLpExited1h: number;
};

export type AlertConfig = {
  /** Band size in quote units. */
  bandSize: number;
  /** Half-width of the band as a fraction of price. */
  bandHalfWidth: number;
  /** Minimum trailing hour of volume, quote units. */
  minVolume1h: number;
  /** Maximum in-band liquidity to consider — above this the share is too thin. */
  maxBandLiquidity: number;
  /** Must still trade above this fraction of the 24h peak. */
  minPeakFraction: number;
  /** Minimum pool age, minutes. */
  minAgeMinutes: number;
  /** See {@link estimateFees}. 1 shows the upper bound. */
  captureEfficiency: number;
};

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  bandSize: 10_000,
  bandHalfWidth: 0.05,
  minVolume1h: 25_000,
  maxBandLiquidity: 400_000,
  minPeakFraction: 0.6,
  minAgeMinutes: 20,
  captureEfficiency: 1,
};

/**
 * Quote-denominated value of the liquidity sitting within ±`halfWidth` of the
 * current price, taken from the pool's active liquidity.
 *
 * Both sides count: token1 held below spot down to the lower bound, and token0
 * held above spot up to the upper bound, marked at spot. A band competes with
 * all of it for flow in either direction.
 */
export function liquidityInBand(pool: PoolState, halfWidth: number): number {
  if (pool.liquidity <= 0n) return 0;

  const price = spotPrice(pool);
  const sqrtP = pool.sqrtPriceX96;
  const sqrtLower = BigInt(Math.floor(Number(sqrtP) * Math.sqrt(1 - halfWidth)));
  const sqrtUpper = BigInt(Math.floor(Number(sqrtP) * Math.sqrt(1 + halfWidth)));

  const token0 = amount0Delta(sqrtP, sqrtUpper, pool.liquidity);
  const token1 = amount1Delta(sqrtLower, sqrtP, pool.liquidity);

  const value0 = (Number(token0) / 10 ** pool.token0.decimals) * price;
  const value1 = Number(token1) / 10 ** pool.token1.decimals;
  return value0 + value1;
}

/** Share of in-range flow a band of `size` would take against `inBand` liquidity. */
export const bandShare = (size: number, inBand: number) => size / (size + inBand);

export type FeeEstimate = { m5: number; h1: number; h6: number; h24: number };

/**
 * volume × fee tier × share, per window.
 *
 * This is an UPPER BOUND on band income, not an expectation, and the gap is
 * large. It assumes every unit of reported pool flow transacts through the
 * band's own range at the band's full share; a pool's flow includes trades at
 * prices the band does not cover, and in concentrated liquidity only the active
 * tick earns.
 *
 * Measured against live positions on comparable pools: one at 13.3% share of
 * $1.25M/h at a 2% fee earned $481/h against a naive $3,325/h — 14.5% of the
 * bound. Another at 89.1% share came in near the bound, because at that share
 * nearly all flow does cross the band. Capture falls as share
 * falls, so this figure is worst on exactly the deep pools it looks best on.
 *
 * `captureEfficiency` scales it. It defaults to 1 so the board shows the bound
 * rather than a factor fitted to two observations — set it from your own fills.
 */
export function estimateFees(
  volume: VolumeWindows,
  feePips: number,
  share: number,
  captureEfficiency = 1,
): FeeEstimate {
  const rate = (feePips / 1_000_000) * share * captureEfficiency;
  return {
    m5: volume.m5 * rate,
    h1: volume.h1 * rate,
    h6: volume.h6 * rate,
    h24: volume.h24 * rate,
  };
}

export type Gate = { name: string; passed: boolean; detail: string };

export type Alert = {
  address: string;
  pair: string;
  feeTier: number;
  price: number;
  inBandLiquidity: number;
  share: number;
  fees: FeeEstimate;
  /** Annualised return on the band from the trailing hour. Ranking figure only. */
  impliedApr: number;
  gates: Gate[];
  qualifies: boolean;
  /** The band an operator would place, as a price range. */
  bandLine: { lower: number; upper: number; size: number };
  smartLpPresent: number;
  smartLpExited1h: number;
};

/** Evaluate one pool against the gates. */
export function evaluatePool(
  obs: PoolObservation,
  config: AlertConfig = DEFAULT_ALERT_CONFIG,
): Alert {
  const price = spotPrice(obs.pool);
  const inBand = liquidityInBand(obs.pool, config.bandHalfWidth);
  const share = bandShare(config.bandSize, inBand);
  const fees = estimateFees(obs.volume, obs.pool.fee, share, config.captureEfficiency);

  // Trailing hour, annualised against the band. A ranking figure, not a promise.
  const impliedApr = (fees.h1 * 24 * 365) / config.bandSize;

  const peakFraction = obs.peak24h > 0 ? price / obs.peak24h : 0;

  const gates: Gate[] = [
    {
      name: "hook-free with a real fee",
      passed: !obs.hasHook && obs.pool.fee > 0,
      detail: obs.hasHook
        ? "runs a v4 hook — it can take the LP's fee"
        : `${obs.pool.fee / 10_000}% fee tier`,
    },
    {
      name: "volume",
      passed: obs.volume.h1 >= config.minVolume1h,
      detail: `$${Math.round(obs.volume.h1).toLocaleString("en-US")} in the last hour`,
    },
    {
      name: "depth under the cap",
      passed: inBand > 0 && inBand <= config.maxBandLiquidity,
      detail:
        inBand === 0
          ? "no liquidity within the band"
          : `$${Math.round(inBand).toLocaleString("en-US")} within ±${config.bandHalfWidth * 100}%`,
    },
    {
      name: "holding its range",
      passed: peakFraction >= config.minPeakFraction,
      detail: `${(peakFraction * 100).toFixed(0)}% of the 24h peak`,
    },
    {
      name: "old enough",
      passed: obs.ageMinutes >= config.minAgeMinutes,
      detail: `${Math.round(obs.ageMinutes)} minutes old`,
    },
    {
      name: "LPs winning",
      passed: obs.smartLpNet > 0,
      detail:
        obs.smartLpNet > 0
          ? `${obs.smartLpNet} more winners than losers`
          : "liquidity providers are not winning here",
    },
  ];

  return {
    address: obs.address,
    pair: `${obs.pool.token0.symbol}/${obs.pool.token1.symbol}`,
    feeTier: obs.pool.fee,
    price,
    inBandLiquidity: inBand,
    share,
    fees,
    impliedApr,
    gates,
    qualifies: gates.every((g) => g.passed),
    bandLine: {
      lower: price * (1 - config.bandHalfWidth),
      upper: price * (1 + config.bandHalfWidth),
      size: config.bandSize,
    },
    smartLpPresent: obs.smartLpPresent,
    smartLpExited1h: obs.smartLpExited1h,
  };
}

export type Board = {
  qualifying: Alert[];
  /** Evaluated but not qualifying, kept so a passed spike is still readable. */
  rejected: Alert[];
  generatedAt: string;
  config: AlertConfig;
};

/**
 * Rank a set of pools. Qualifying pools sort by trailing-hour fee estimate;
 * everything else is kept rather than dropped, because a pool that just stopped
 * qualifying is information.
 */
export function buildBoard(
  observations: PoolObservation[],
  config: AlertConfig = DEFAULT_ALERT_CONFIG,
): Board {
  const alerts = observations.map((o) => evaluatePool(o, config));
  const byFee = (a: Alert, b: Alert) => b.fees.h1 - a.fees.h1;

  return {
    qualifying: alerts.filter((a) => a.qualifies).sort(byFee),
    rejected: alerts.filter((a) => !a.qualifies).sort(byFee),
    generatedAt: new Date().toISOString(),
    config,
  };
}
