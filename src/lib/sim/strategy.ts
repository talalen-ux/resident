/**
 * Band policy: how wide, when to enter, when to leave.
 *
 * The naive way to run a band is to open a fixed ±width, re-centre when it
 * drifts out, and retire on a gross mark loss. Live positions run that way show
 * most of them underwater on principal while still net positive after fees —
 * which is the strategy working, but it also means the entry decision was never
 * about whether fees would outrun the bleed. It was about the fee number being
 * large.
 *
 * This module makes that the decision instead:
 *
 *   - width comes from the pool's realised volatility, so time in range is a
 *     target rather than an accident of a constant;
 *   - entry requires expected fee income to exceed expected divergence loss at
 *     that volatility, not merely to be big;
 *   - the stop is on NET — fees already banked less the bleed — because a
 *     gross-drawdown stop throws away a position the fees have already paid for.
 */

import { divergenceLoss, liquidityForCapital, openBand } from "./band.ts";

/** Standard deviation of per-interval log returns. */
export function realisedVolatility(prices: number[], lookback = prices.length): number {
  const window = prices.slice(-Math.max(2, lookback));
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1] > 0 && window[i] > 0) {
      returns.push(Math.log(window[i] / window[i - 1]));
    }
  }
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

export type WidthConfig = {
  /**
   * Intervals the band is expected to hold before re-centring.
   *
   * Width scales with the square root of this: a band meant to last a day must
   * be far wider than one meant to last an hour at the same volatility.
   */
  horizon: number;
  /**
   * Sigma multiple setting the band's width.
   *
   * Calibrated by measurement, not derived — at vol 0.004 over a 240-interval
   * horizon, the fraction of time a random walk spends inside the band is:
   *
   *   1.00σ  w=0.062  83.0%      1.75σ  w=0.108  98.1%
   *   1.25σ  w=0.078  90.8%      2.00σ  w=0.124  99.2%
   *   1.50σ  w=0.093  95.6%      2.50σ  w=0.155  99.8%
   *
   * Because share is density-weighted, halving the width roughly doubles the
   * fee share, so the last few points of time-in-range are expensive: 2.5σ buys
   * 9 points over 1.25σ and gives up about half the income to do it. 1.25σ is
   * the default for that reason.
   */
  sigmas: number;
  minWidth: number;
  maxWidth: number;
};

export const DEFAULT_WIDTH_CONFIG: WidthConfig = {
  horizon: 240, // four hours of minute intervals
  sigmas: 1.25,
  minWidth: 0.01,
  maxWidth: 0.6,
};

/** Half-width for a band expected to hold `horizon` intervals at this vol. */
export function bandWidth(
  volatility: number,
  config: WidthConfig = DEFAULT_WIDTH_CONFIG,
): number {
  const raw = config.sigmas * volatility * Math.sqrt(config.horizon);
  return Math.min(config.maxWidth, Math.max(config.minWidth, raw));
}

/**
 * Expected divergence loss per interval for a band of this width at this vol.
 *
 * Evaluated with the exact position algebra at a one-sigma move rather than the
 * quadratic approximation, and averaged over both directions — the loss is not
 * symmetric in price, only in log price.
 */
export function expectedBleedRate(halfWidth: number, volatility: number): number {
  if (volatility <= 0) return 0;
  const band = openBand(1, halfWidth, 1);
  const up = -divergenceLoss(band, Math.exp(volatility));
  const down = -divergenceLoss(band, Math.exp(-volatility));
  return (up + down) / 2;
}

/**
 * Share of in-range flow a band takes, accounting for concentration.
 *
 * Naively share = capital/(capital + poolLiquidity), which is what a fee-ranked
 * board computes — and it is wrong in a way that matters, because it makes band
 * width free. The same capital spread over ±20% has a quarter the liquidity
 * density of ±5%, and earns proportionally less of the flow crossing any given
 * price. Comparing actual L values rather than dollar amounts prices that in,
 * so widening for safety costs income, which is the real trade.
 *
 * `poolLiquidity` is quote-denominated within `referenceWidth` of spot, which is
 * how an indexer reports it.
 */
export function concentratedShare(
  deployed: number,
  halfWidth: number,
  poolLiquidity: number,
  referenceWidth = 0.05,
  price = 1,
): number {
  const bandL = liquidityForCapital(
    deployed,
    price * (1 - halfWidth),
    price * (1 + halfWidth),
    price,
  );
  const poolL = liquidityForCapital(
    poolLiquidity,
    price * (1 - referenceWidth),
    price * (1 + referenceWidth),
    price,
  );
  if (bandL + poolL <= 0) return 0;
  return bandL / (bandL + poolL);
}

export type EntryInputs = {
  /** Quote volume per interval. */
  volume: number;
  /** Quote-denominated liquidity competing inside the band. */
  liquidity: number;
  feePips: number;
  volatility: number;
  /** Capital that would actually reach the pool. */
  deployed: number;
  /** See BandConfig.captureEfficiency — the naive formula is an upper bound. */
  captureEfficiency: number;
};

export type EntryVerdict = {
  halfWidth: number;
  share: number;
  /** Fee income per interval as a fraction of deployed capital. */
  feeRate: number;
  /** Expected divergence loss per interval, same units. */
  bleedRate: number;
  /** feeRate − bleedRate. The number the decision turns on. */
  netRate: number;
  /** Net rate annualised, for comparison across pools. */
  netApr: number;
  enter: boolean;
  reason: string;
};

export type EntryConfig = {
  width: WidthConfig;
  /** Minimum net rate per interval to bother. */
  minNetRate: number;
  /** Intervals per year, for annualising. */
  intervalsPerYear: number;
};

export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  width: DEFAULT_WIDTH_CONFIG,
  minNetRate: 0,
  intervalsPerYear: 525_600, // minute intervals
};

/**
 * Should the desk open a band here?
 *
 * The test is whether fees outrun the bleed at this pool's own volatility — not
 * whether the fee figure is large. A pool paying 3% a day into a book that
 * moves 20% a day is a losing position however good the headline looks, and
 * that is exactly the position a fee-ranked board recommends.
 */
export function evaluateEntry(
  inputs: EntryInputs,
  config: EntryConfig = DEFAULT_ENTRY_CONFIG,
): EntryVerdict {
  const halfWidth = bandWidth(inputs.volatility, config.width);
  const share = concentratedShare(inputs.deployed, halfWidth, inputs.liquidity);

  const feeIncome =
    inputs.volume * (inputs.feePips / 1_000_000) * share * inputs.captureEfficiency;
  const feeRate = inputs.deployed > 0 ? feeIncome / inputs.deployed : 0;
  const bleedRate = expectedBleedRate(halfWidth, inputs.volatility);
  const netRate = feeRate - bleedRate;

  const enter = netRate > config.minNetRate;
  return {
    halfWidth,
    share,
    feeRate,
    bleedRate,
    netRate,
    netApr: netRate * config.intervalsPerYear,
    enter,
    reason: enter
      ? `fees ${(feeRate * 1e4).toFixed(2)}bps/interval beat bleed ${(bleedRate * 1e4).toFixed(2)}bps`
      : `bleed ${(bleedRate * 1e4).toFixed(2)}bps/interval swamps fees ${(feeRate * 1e4).toFixed(2)}bps`,
  };
}

export type ExitConfig = {
  /**
   * Retire when net — fees banked, less the bleed — falls this far below
   * capital.
   *
   * Set at 35%, matching the stop live positions on comparable pools run. It
   * is stated as net because net is what this module computes — measuring the
   * stop on gross would discard positions the fees have already paid for.
   */
  maxNetLossFraction: number;
  /** Intervals out of range before re-centring. */
  rebalanceAfter: number;
  /** Abandon the pool if the net rate stays negative this many intervals. */
  staleAfter: number;
};

export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  maxNetLossFraction: 0.35,
  rebalanceAfter: 5,
  staleAfter: 120,
};
