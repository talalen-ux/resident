/**
 * When to close a position that is still working and re-open it at the price.
 *
 * The instinct is to hold a winner and cut a loser, and on a ranging coin that
 * is backwards. A position drifts, the price walks toward its edge, and the fee
 * rate collapses long before the position looks bad — it is still up, it is
 * still open, and it has quietly stopped earning. Re-centring on the same coin
 * can out-earn leaving it alone by more than the move costs.
 *
 * THE COST THAT IS NOT A COST
 *
 * The objection to closing is usually "I do not want to realise the loss".
 * But the divergence loss is already taken: the position is holding whatever
 * the price move left it holding, and its value is what it is whether or not
 * you close. Closing does not create that loss, it only writes it down. The
 * genuine costs of re-centring are gas and the slippage on rebalancing the
 * token ratio — and those are usually small next to a fee rate that has halved.
 *
 * Treating the unrealised loss as a cost of moving is the single most expensive
 * mistake available here, because it argues for holding exactly the positions
 * that have stopped paying.
 */

export type OpenPosition = {
  name: string;
  /** Capital committed, in quote units. */
  capital: number;
  /** Fee rate per interval the position is earning WHERE THE PRICE IS NOW. */
  currentRate: number;
  /** Fees collected so far and not yet swept, in quote units. */
  feesUnclaimed: number;
  /** Intervals since it was opened. */
  ageIntervals: number;
};

export type RebalanceCost = {
  /** Gas for closing and re-opening, in quote units. */
  gas: number;
  /**
   * Slippage on rebalancing the token ratio, as a fraction of capital.
   *
   * This is a real cost and the only trading cost of re-centring. The change in
   * the position's value from the price move is NOT included, deliberately:
   * see the note above.
   */
  slippageFraction: number;
};

export type RebalanceConfig = {
  /**
   * How long the re-centred position is expected to hold before this question
   * comes round again. The uplift is only worth what it earns before then.
   */
  horizon: number;
  /**
   * Multiple of the cost the uplift must clear.
   *
   * Above 1 so a rate estimate that is noisy by a few percent cannot churn a
   * position, which costs gas every time and compounds badly.
   */
  requiredMargin: number;
  /**
   * Do not re-centre a position younger than this, whatever the maths says.
   * Fee rates are noisiest immediately after opening.
   */
  minAgeIntervals: number;
};

export const DEFAULT_REBALANCE: RebalanceConfig = {
  horizon: 720,
  requiredMargin: 2,
  minAgeIntervals: 30,
};

export type RebalanceVerdict = {
  rebalance: boolean;
  /** How far the fee rate has fallen from what a fresh position would earn. */
  decay: number;
  uplift: number;
  cost: number;
  margin: number;
  reason: string;
};

/**
 * Should this position be closed and re-opened at the current price?
 *
 * `recenteredRate` is what a fresh position on the same pool would earn right
 * now — from evaluateEntry or evaluateDlmm at the current price. The comparison
 * is between carrying on as we are and starting again here, over the same
 * horizon, and it is only the DIFFERENCE that has to pay for the move.
 */
export function shouldRebalance(
  position: OpenPosition,
  recenteredRate: number,
  cost: RebalanceCost,
  config: RebalanceConfig = DEFAULT_REBALANCE,
): RebalanceVerdict {
  const decay =
    recenteredRate > 0 ? 1 - position.currentRate / recenteredRate : 0;

  const edge = recenteredRate - position.currentRate;
  const uplift = edge * position.capital * config.horizon;
  const totalCost = cost.gas + position.capital * cost.slippageFraction;
  const margin = totalCost > 0 ? uplift / totalCost : uplift > 0 ? Infinity : 0;

  let rebalance = false;
  let reason: string;

  if (position.ageIntervals < config.minAgeIntervals) {
    reason = `only ${position.ageIntervals} intervals old`;
  } else if (edge <= 0) {
    reason = "a fresh position here would not earn more";
  } else if (margin < config.requiredMargin) {
    reason = `uplift covers ${margin.toFixed(2)}x the cost, needs ${config.requiredMargin}x`;
  } else {
    rebalance = true;
    reason =
      `earning ${(decay * 100).toFixed(0)}% less than a fresh position; ` +
      `uplift covers ${margin.toFixed(2)}x the cost`;
  }

  return { rebalance, decay, uplift, cost: totalCost, margin, reason };
}

export const RANGING_THRESHOLDS = {
  /** Fraction of the history that must have sat inside the band. */
  containment: 0.8,
  /** Most the last stretch may sit away from the first. */
  drift: 0.4,
  /** Half-width of the band containment is measured against. */
  bandHalfWidth: 0.35,
};

/**
 * Whether a pool has been RANGING rather than trending.
 *
 * A coin that has held a band for months is a different proposition from one
 * that spiked yesterday, even when this hour's fees look identical. The band is
 * the thing being sold: liquidity is only worth providing where the price keeps
 * coming back, and a chart that only goes one way hands you the wrong side of
 * it the whole way down.
 *
 * Two things are measured, and both have to hold. Containment is the fraction
 * of the history spent inside a band around the median, which a trend fails
 * because it spends most of its time somewhere it never returns to. Drift is
 * how far the last stretch sits from the first, which catches a slow grind that
 * technically stays in a wide band while going nowhere good.
 */
export function rangingScore(
  prices: number[],
  bandHalfWidth = RANGING_THRESHOLDS.bandHalfWidth,
): { containment: number; drift: number; ranging: boolean } {
  if (prices.length < 10) return { containment: 0, drift: 1, ranging: false };

  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return { containment: 0, drift: 1, ranging: false };

  const inside = prices.filter(
    (p) => Math.abs(p / median - 1) <= bandHalfWidth,
  ).length;
  const containment = inside / prices.length;

  const slice = Math.max(1, Math.floor(prices.length / 5));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = mean(prices.slice(0, slice));
  const last = mean(prices.slice(-slice));
  const drift = first > 0 ? Math.abs(last / first - 1) : 1;

  return {
    containment,
    drift,
    ranging:
      containment >= RANGING_THRESHOLDS.containment &&
      drift <= RANGING_THRESHOLDS.drift,
  };
}
