/**
 * Meteora DLMM position maths.
 *
 * DLMM is not Uniswap v3 with different names, and the difference decides
 * whether a position earns:
 *
 *   - Liquidity sits in discrete BINS. Bin i covers a single price,
 *     p(i) = (1 + binStep/10_000)^i, and inside a bin the curve is constant
 *     SUM rather than constant product — so a trade inside one bin has no
 *     slippage at all.
 *
 *   - ONLY THE ACTIVE BIN EARNS FEES. In v3 every unit of in-range liquidity
 *     collects; here only the single bin the price currently sits in does.
 *     Capital in your other bins is parked, not working.
 *
 * That second point is the whole game. Spreading capital over 60 bins does not
 * buy you a wide earning range — it divides your stake in whichever bin happens
 * to be active by 60. Width costs far more here than it does in v3, and a model
 * carried over from v3 will overstate a wide DLMM position badly.
 *
 * Bins below the active one hold only quote, bins above hold only base, which
 * is why a position that has been crossed is entirely on one side.
 */

import { expectedBleedRate } from "./strategy.ts";

/** Price at a bin id. binStep is in basis points: 100 = 1% between bins. */
export function binPrice(binId: number, binStep: number): number {
  return (1 + binStep / 10_000) ** binId;
}

/** The bin whose price bracket contains this price. */
export function binIdForPrice(price: number, binStep: number): number {
  if (price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1 + binStep / 10_000));
}

/**
 * Half-width of a position spread over `binCount` bins, as a fraction.
 *
 * Used to price the divergence loss with the same algebra the v3 side uses:
 * the inventory a bin position ends up holding after a move is close enough to
 * a range position of this width for the bleed to be comparable, and pricing
 * both the same way is what lets a Solana venue be compared against a Robinhood
 * one at all. It is an approximation, and it is the weaker half of this model.
 */
export function binHalfWidth(binCount: number, binStep: number): number {
  const sideBins = Math.max(0, (binCount - 1) / 2);
  return (1 + binStep / 10_000) ** sideBins - 1;
}

export type DlmmInputs = {
  /** Quote volume per interval. */
  volume: number;
  feeBps: number;
  binStep: number;
  /** How many bins the position is spread across. 1 concentrates everything. */
  binCount: number;
  /** Capital that actually reaches the pool. */
  deployed: number;
  /** Quote-denominated liquidity already sitting in a typical bin. */
  liquidityPerBin: number;
  /** Per-interval volatility of the pair. */
  volatility: number;
  /** See BandConfig.captureEfficiency — the naive formula is an upper bound. */
  captureEfficiency: number;
};

export type DlmmVerdict = {
  halfWidth: number;
  /** Share of the active bin, which is the only share that earns. */
  activeBinShare: number;
  /** Fraction of intervals the price is expected to sit inside the position. */
  timeInRange: number;
  feeRate: number;
  bleedRate: number;
  netRate: number;
  netApr: number;
  reason: string;
};

/**
 * Fraction of time a random walk of this volatility stays inside the position.
 *
 * Same shape as the calibration behind the v3 width policy: a band of half
 * width w at volatility σ holds for roughly (w/σ)² intervals, so over a horizon
 * the time inside falls away as the band narrows. Clamped to [0,1] because it
 * is an estimate, not a probability derived from first principles.
 */
export function timeInRange(halfWidth: number, volatility: number, horizon = 240) {
  if (volatility <= 0) return 1;
  if (halfWidth <= 0) return 0;
  const sigmas = halfWidth / (volatility * Math.sqrt(horizon));
  // 1.25σ measured ~91% in range; scale that relationship and clamp.
  return Math.min(1, Math.max(0, 1 - Math.exp(-1.9 * sigmas)));
}

/**
 * Price a DLMM position, in the same units evaluateEntry returns for a v3 band
 * so the two can be compared directly.
 */
export function evaluateDlmm(
  inputs: DlmmInputs,
  intervalsPerYear = 525_600,
): DlmmVerdict {
  const halfWidth = binHalfWidth(inputs.binCount, inputs.binStep);
  const inRange = timeInRange(halfWidth, inputs.volatility);

  // Only the active bin earns, so the stake that matters is what sits in ONE
  // bin — the position divided by its bin count, not the position.
  const perBin = inputs.binCount > 0 ? inputs.deployed / inputs.binCount : 0;
  const activeBinShare =
    perBin + inputs.liquidityPerBin > 0
      ? perBin / (perBin + inputs.liquidityPerBin)
      : 0;

  const feeIncome =
    inputs.volume *
    (inputs.feeBps / 10_000) *
    activeBinShare *
    inRange *
    inputs.captureEfficiency;

  const feeRate = inputs.deployed > 0 ? feeIncome / inputs.deployed : 0;
  const bleedRate = expectedBleedRate(halfWidth, inputs.volatility);
  const netRate = feeRate - bleedRate;

  return {
    halfWidth,
    activeBinShare,
    timeInRange: inRange,
    feeRate,
    bleedRate,
    netRate,
    netApr: netRate * intervalsPerYear,
    reason:
      netRate > 0
        ? `${(feeRate * 1e4).toFixed(2)}bps beats bleed ${(bleedRate * 1e4).toFixed(2)}bps`
        : `bleed ${(bleedRate * 1e4).toFixed(2)}bps swamps ${(feeRate * 1e4).toFixed(2)}bps`,
  };
}

/**
 * The bin count with the best net rate, searched rather than assumed.
 *
 * Narrow concentrates the stake in the active bin; wide keeps the price inside
 * more often. Neither wins everywhere, and on DLMM the trade is much sharper
 * than on v3 because width divides the earning stake directly.
 */
export function bestBinCount(
  inputs: Omit<DlmmInputs, "binCount">,
  candidates = [1, 3, 5, 9, 15, 25, 41, 69],
): { binCount: number; verdict: DlmmVerdict } {
  let best = { binCount: candidates[0], verdict: evaluateDlmm({ ...inputs, binCount: candidates[0] }) };
  for (const binCount of candidates.slice(1)) {
    const verdict = evaluateDlmm({ ...inputs, binCount });
    if (verdict.netRate > best.verdict.netRate) best = { binCount, verdict };
  }
  return best;
}
