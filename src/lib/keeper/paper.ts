/**
 * A paper book, marked against real prices.
 *
 * The dry-run executor already opens positions and journals them, so the desk
 * can be run end to end with no key. What it could not do was mark them: the
 * live keeper reads value and fees off the chain, and a paper position has no
 * chain entry to read. So it never produced a return, and a week of running
 * proved only that the loop did not crash.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 * The price is real. It comes from the same pool observation the scanner ranks,
 * so the principal leg — what the price move did to the position — is a genuine
 * measurement. That matters more than it sounds: divergence is what actually
 * decides whether concentrated liquidity pays, and it is the half a spreadsheet
 * always gets wrong.
 *
 * The fees are modelled. A position that was never opened collects nothing, so
 * income is the model's own estimate of what it would have earned. That figure
 * cannot validate the model — it IS the model — and every number derived from
 * it is labelled `modelled` all the way to the report. A paper book that quietly
 * mixed the two would produce a track record of its own assumptions.
 *
 * So: trust the principal, treat the income as a hypothesis, and replace it with
 * measured capture the moment real positions exist.
 */

import { liquidityForCapital, positionAmounts, positionValue } from "../sim/band.ts";
import { concentratedShare, expectedBleedRate } from "../sim/strategy.ts";
import type { PositionObservation } from "./decide.ts";
import type { PositionSeries } from "./marks.ts";
import { ratesFrom } from "./observer.ts";
import type { KeeperPosition } from "./types.ts";

export type PaperInputs = {
  position: KeeperPosition;
  /** Price now, from the live pool. Real. */
  price: number;
  /** Price when the position was opened, from the journal's first mark. */
  openPrice: number;
  /** Quote volume per interval in the pool. Real. */
  volume: number;
  /** Quote liquidity competing in the band. Real. */
  liquidity: number;
  volatility: number;
  /** The pool's fee tier, in millionths. Real. */
  feePips: number;
  /** Capture the scanner is pricing this pool at. */
  captureEfficiency: number;
  /** Fees modelled as accrued since the last sweep. */
  feesAccrued: number;
  freshHalfWidth: number;
  series: PositionSeries | undefined;
  now: number;
  intervalMs: number;
};

/**
 * Mark one paper position.
 *
 * Value is computed from the position's real bounds and the real price through
 * the same Uniswap algebra a live mark uses, so a paper book and a live book
 * are marked by identical arithmetic. Only the fee leg differs.
 */
export function markPaper(inputs: PaperInputs): PositionObservation & {
  /** Fee income here is the model's own estimate, never a measurement. */
  modelled: true;
  /** What the same tokens would be worth if simply held, at today's price. */
  heldValue: number;
} {
  const { position, price, openPrice } = inputs;

  // Liquidity the position would have been given for its capital at the price
  // it was opened at. Derived rather than stored, so a paper book rebuilt from
  // the journal marks identically to one that never restarted.
  const liquidity = liquidityForCapital(
    position.capital,
    position.lower,
    position.upper,
    openPrice,
  );
  const value = positionValue(liquidity, position.lower, position.upper, price);

  // What the same tokens would be worth had they simply been held.
  //
  // The comparison that matters, and the one a quote-denominated P&L hides:
  // as price rises a band's value in quote terms rises too, so principal alone
  // can read as a gain on exactly the move that cost the position money. The
  // loss is always relative to holding.
  const opened = positionAmounts(liquidity, position.lower, position.upper, openPrice);
  const held = opened.amount0 * price + opened.amount1;

  const inRange = price >= position.lower && price <= position.upper;
  const halfWidth = inRange
    ? Math.min(price - position.lower, position.upper - price) / price
    : 0;

  let feeIncome = 0;
  let rate = 0;
  if (inRange && halfWidth > 0 && value > 0) {
    const share = concentratedShare(value, halfWidth, inputs.liquidity);
    feeIncome =
      inputs.volume * (inputs.feePips / 1_000_000) * share * inputs.captureEfficiency;
    rate = feeIncome / value - expectedBleedRate(halfWidth, inputs.volatility);
  }

  const interval = Math.max(1, inputs.intervalMs);
  return {
    positionId: position.id,
    currentRate: rate,
    feeEstimate: feeIncome,
    feesUnclaimed: inputs.feesAccrued,
    value,
    price,
    unrealised: value - position.capital,
    heldValue: held,
    recentRates: [...ratesFrom(inputs.series), rate],
    freshLower: price * (1 - inputs.freshHalfWidth),
    freshUpper: price * (1 + inputs.freshHalfWidth),
    ageIntervals: Math.floor((inputs.now - position.openedAt) / interval),
    intervalsSinceSweep: Math.floor((inputs.now - position.lastSweptAt) / interval),
    modelled: true,
  };
}

/**
 * Fees a paper position has accrued since its last sweep.
 *
 * Summed from the estimates already written on its marks rather than
 * recomputed, so what the report shows is exactly what the desk decided on. A
 * second derivation here could disagree with the first, and then no number in
 * the system would be the one the rules used.
 */
export function accruedFrom(series: PositionSeries | undefined): number {
  if (!series) return 0;
  const lastSweep = series.sweeps.length
    ? series.sweeps[series.sweeps.length - 1].at
    : 0;
  return series.marks
    .filter((mark) => mark.at > lastSweep)
    .reduce((total, mark) => total + (mark.feeEstimate ?? 0), 0);
}

export type PaperReturn = {
  deposit: number;
  /** Cash not committed to a position. */
  cash: number;
  /** Marked value of open positions, principal only. */
  positionValue: number;
  /** Modelled fees sitting unswept inside open positions. */
  feesUnswept: number;
  /** Modelled fees taken out of positions and returned to cash. */
  feesSwept: number;
  /** Principal gained or lost on open positions, in quote terms. */
  principalChange: number;
  /**
   * Position value less what the same tokens would be worth if held.
   *
   * The figure that says whether providing liquidity beat not providing it.
   * Never positive for an in-range band, and it is what the modelled fee income
   * has to cover before the position has made anything at all.
   */
  divergence: number;
  /** cash + positionValue + feesUnswept. */
  equity: number;
  /** equity / deposit - 1. */
  totalReturn: number;
};

/**
 * The book, as one set of figures.
 *
 * Principal and fees are returned separately and never summed into a single
 * "profit", because one of them is measured and the other is modelled. A caller
 * that wants one number has to add them itself and, in doing so, notice what it
 * is adding.
 */
export function paperReturn(inputs: {
  deposit: number;
  cash: number;
  positions: Array<{
    capital: number;
    value: number;
    feesUnclaimed: number;
    /** What holding the same tokens would be worth now. */
    heldValue: number;
  }>;
  feesSwept: number;
}): PaperReturn {
  const positionValue = inputs.positions.reduce((sum, p) => sum + p.value, 0);
  const committed = inputs.positions.reduce((sum, p) => sum + p.capital, 0);
  const feesUnswept = inputs.positions.reduce((sum, p) => sum + p.feesUnclaimed, 0);
  const equity = inputs.cash + positionValue + feesUnswept;

  return {
    deposit: inputs.deposit,
    cash: inputs.cash,
    positionValue,
    feesUnswept,
    feesSwept: inputs.feesSwept,
    principalChange: positionValue - committed,
    divergence:
      positionValue - inputs.positions.reduce((sum, p) => sum + p.heldValue, 0),
    equity,
    totalReturn: inputs.deposit > 0 ? equity / inputs.deposit - 1 : 0,
  };
}
