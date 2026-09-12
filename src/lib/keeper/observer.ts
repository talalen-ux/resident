/**
 * Turn what the chain says into what the decision engine expects.
 *
 * decide.ts is complete and tested, and until now it was fed hardcoded empties
 * by the live keeper: no balance, no positions, no inventory. Five of its seven
 * rules could never fire, so the desk ranked the board correctly and was blind
 * to its own book. This is the join between the two.
 *
 * Everything here is a pure function over values the caller has already read.
 * The RPC lives in the keeper script; what is worth testing is the arithmetic,
 * and the arithmetic is what gets a position retired or held.
 */

import { concentratedShare, expectedBleedRate } from "../sim/strategy.ts";
import type { PositionObservation } from "./decide.ts";
import type { PositionSeries } from "./marks.ts";
import type { KeeperPosition } from "./types.ts";
import { priceAtTick, valueOf, type PositionRead } from "./position-reader.ts";

/** Raw token units to a human amount. */
export function toUnits(raw: bigint, decimals: number): number {
  return Number(raw) / Math.pow(10, decimals);
}

/**
 * What one position is earning right now, at its own bounds.
 *
 * Not the same question the scanner answers. The scanner prices a band it would
 * open, centred on spot; this prices the band that actually exists, which may
 * have drifted to the edge of its range or out of it entirely.
 *
 * A position whose price has left its range earns nothing. Reporting the rate a
 * centred band would earn is how a desk holds a position that stopped working
 * days ago, so out of range is zero rather than an estimate.
 */
export function rateAndFees(inputs: {
  price: number;
  lower: number;
  upper: number;
  /** Quote value of the position, excluding fees. */
  value: number;
  /** Quote volume per interval in the pool. */
  volume: number;
  /** Quote liquidity competing in the band. */
  liquidity: number;
  feePips: number;
  volatility: number;
  captureEfficiency: number;
}): { rate: number; feeIncome: number } {
  const { price, lower, upper, value } = inputs;
  if (!(value > 0)) return { rate: 0, feeIncome: 0 };
  if (price < lower || price > upper) return { rate: 0, feeIncome: 0 };

  // The half-width the bleed is charged against is the distance to the NEAR
  // edge. A position sitting against one bound is one move from earning
  // nothing, and averaging the two bounds would hide exactly that.
  const halfWidth = Math.min(price - lower, upper - price) / price;
  if (!(halfWidth > 0)) return { rate: 0, feeIncome: 0 };

  const share = concentratedShare(value, halfWidth, inputs.liquidity);
  const feeIncome =
    inputs.volume * (inputs.feePips / 1_000_000) * share * inputs.captureEfficiency;
  return {
    rate: feeIncome / value - expectedBleedRate(halfWidth, inputs.volatility),
    feeIncome,
  };
}

/** Just the rate, for callers that do not need the fee leg. */
export function currentRate(inputs: Parameters<typeof rateAndFees>[0]): number {
  return rateAndFees(inputs).rate;
}

/**
 * The rate history the retire rule runs on, oldest first.
 *
 * Rebuilt from the journal rather than held in memory: a keeper that restarts
 * with an empty history cannot retire anything until it has watched the
 * position for another full run, which is the window in which a dead position
 * keeps bleeding.
 */
export function ratesFrom(series: PositionSeries | undefined, limit = 40): number[] {
  if (!series) return [];
  return series.marks
    .map((mark) => mark.rate)
    .filter((rate): rate is number => typeof rate === "number")
    .slice(-limit);
}

export type ObserveInputs = {
  position: KeeperPosition;
  read: PositionRead;
  /** Pool price in quote units. */
  price: number;
  decimals0: number;
  decimals1: number;
  /** Which side of the pair the quote is. Fees on the other side are converted. */
  quoteIsToken1: boolean;
  volume: number;
  liquidity: number;
  volatility: number;
  captureEfficiency: number;
  /** Half-width a re-centred position would use, as a fraction of price. */
  freshHalfWidth: number;
  series: PositionSeries | undefined;
  now: number;
  intervalMs: number;
};

/**
 * One position, as decide.ts needs to see it.
 *
 * `value` and `feesUnclaimed` are kept apart all the way through, because
 * adding them is how a dashboard reports a position as up while its principal
 * bleeds. decide.ts relies on the separation and so does the ledger.
 */
export function observePosition(inputs: ObserveInputs): PositionObservation {
  const { read, price, decimals0, decimals1 } = inputs;

  const value = valueOf(read, price, decimals0, decimals1);

  // Fees come off the chain in both tokens. Whichever is not the quote is
  // converted at the pool price, which is the same price the value above is
  // measured at, so the two are consistent even when the pool has moved.
  const fees0 = toUnits(read.fees0, decimals0);
  const fees1 = toUnits(read.fees1, decimals1);
  const feesUnclaimed = inputs.quoteIsToken1 ? fees0 * price + fees1 : fees0 + fees1 / price;

  const lower = priceAtTick(read.tickLower, decimals0, decimals1);
  const upper = priceAtTick(read.tickUpper, decimals0, decimals1);

  const { rate, feeIncome } = rateAndFees({
    price,
    lower,
    upper,
    value,
    volume: inputs.volume,
    liquidity: inputs.liquidity,
    feePips: read.fee,
    volatility: inputs.volatility,
    captureEfficiency: inputs.captureEfficiency,
  });

  const interval = Math.max(1, inputs.intervalMs);
  return {
    positionId: inputs.position.id,
    currentRate: rate,
    // What the model says this interval earns in fees, before the bleed. The
    // capture calibration compares the sum of these against what a sweep
    // actually returned, which is the only way the assumed 0.5 is ever
    // replaced by a measurement.
    feeEstimate: feeIncome,
    feesUnclaimed,
    value,
    price,
    // Cost basis is what was committed, and fees banked out of the position are
    // not part of it: they were income the moment they were swept.
    unrealised: value - inputs.position.capital,
    recentRates: [...ratesFrom(inputs.series), rate],
    freshLower: price * (1 - inputs.freshHalfWidth),
    freshUpper: price * (1 + inputs.freshHalfWidth),
    ageIntervals: Math.floor((inputs.now - inputs.position.openedAt) / interval),
    intervalsSinceSweep: Math.floor((inputs.now - inputs.position.lastSweptAt) / interval),
  };
}
