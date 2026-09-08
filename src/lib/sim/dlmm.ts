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

/**
 * How liquidity is spread across the position's bins.
 *
 *   spot     even across every bin
 *   curve    weighted toward the middle, where the price is now
 *   bid-ask  weighted toward the two edges, thin in the middle
 *
 * This is not cosmetic. Only the active bin earns, so what matters is the
 * weight sitting in whichever bin the price is in — and bid-ask deliberately
 * puts the least there. A bid-ask position only out-earns spot if the price
 * spends its time out at the edges; while it sits mid-range, spot has more
 * stake in the earning bin and collects more, which is why a bigger spot
 * position placed below the entry can beat a bid-ask whose liquidity ended up
 * in the top half of the curve.
 */
export type LiquidityShape = "spot" | "curve" | "bid-ask";

/** Normalised weight per bin, index 0 being the lowest bin. */
export function binWeights(shape: LiquidityShape, binCount: number): number[] {
  const n = Math.max(1, Math.floor(binCount));
  if (n === 1) return [1];

  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    // -1 at the bottom edge, 0 in the middle, +1 at the top edge.
    const x = (2 * i) / (n - 1) - 1;
    if (shape === "spot") raw.push(1);
    else if (shape === "curve") raw.push(1 - Math.abs(x) * 0.9);
    else raw.push(0.1 + Math.abs(x) * 0.9);
  }
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
}

/**
 * Probability the active bin sits at each of the position's bins.
 *
 * A discrete Gaussian over bin offsets, with the spread set by how far the
 * price typically travels in a horizon relative to one bin's width. Mass that
 * falls outside the position is dropped — that is the position being out of
 * range, and it earns nothing.
 */
export function activeBinDistribution(
  binCount: number,
  binStep: number,
  volatility: number,
  horizon = 240,
): number[] {
  const n = Math.max(1, Math.floor(binCount));
  const binWidth = binStep / 10_000;
  const travel = volatility * Math.sqrt(horizon);
  const sigmaBins = binWidth > 0 ? travel / binWidth : 0;

  if (sigmaBins <= 0) {
    const only = new Array(n).fill(0);
    only[Math.floor(n / 2)] = 1;
    return only;
  }

  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) =>
    Math.exp(-0.5 * ((i - mid) / sigmaBins) ** 2),
  ).map((v) => v / (sigmaBins * Math.sqrt(2 * Math.PI)) / (1 / 1));
}

export type DlmmInputs = {
  /** Quote volume per interval. */
  volume: number;
  feeBps: number;
  binStep: number;
  /** How many bins the position is spread across. 1 concentrates everything. */
  binCount: number;
  /** How the capital is distributed across those bins. */
  shape: LiquidityShape;
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
  /** Stake-weighted share of the earning bin, over where the price actually sits. */
  effectiveShare: number;
  /** Fraction of intervals the price is expected to sit inside the position. */
  timeInRange: number;
  feeRate: number;
  bleedRate: number;
  netRate: number;
  netApr: number;
  reason: string;
};

/**
 * Price a DLMM position, in the same units evaluateEntry returns for a v3 band
 * so the two can be compared directly.
 *
 * Fees are summed over where the price actually spends its time rather than
 * assumed uniform: at each bin, the share of that bin's liquidity we hold,
 * weighted by how often the price is there.
 */
export function evaluateDlmm(
  inputs: DlmmInputs,
  intervalsPerYear = 525_600,
): DlmmVerdict {
  const halfWidth = binHalfWidth(inputs.binCount, inputs.binStep);
  const weights = binWeights(inputs.shape, inputs.binCount);
  const presence = activeBinDistribution(
    inputs.binCount,
    inputs.binStep,
    inputs.volatility,
  );

  let inRange = 0;
  let weightedShare = 0;
  for (let i = 0; i < weights.length; i++) {
    const here = presence[i] ?? 0;
    const ourStake = inputs.deployed * weights[i];
    const share =
      ourStake + inputs.liquidityPerBin > 0
        ? ourStake / (ourStake + inputs.liquidityPerBin)
        : 0;
    inRange += here;
    weightedShare += here * share;
  }
  inRange = Math.min(1, inRange);
  const effectiveShare = inRange > 0 ? weightedShare / inRange : 0;

  const feeIncome =
    inputs.volume *
    (inputs.feeBps / 10_000) *
    weightedShare *
    inputs.captureEfficiency;

  const feeRate = inputs.deployed > 0 ? feeIncome / inputs.deployed : 0;
  const bleedRate = expectedBleedRate(halfWidth, inputs.volatility);
  const netRate = feeRate - bleedRate;

  return {
    halfWidth,
    effectiveShare,
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
 * The shape and width with the best net rate, searched rather than assumed.
 *
 * Narrow concentrates the stake in the earning bin; wide keeps the price inside
 * more often. On DLMM the trade is much sharper than on v3, because width
 * divides the earning stake directly rather than spreading an earning range.
 */
export function bestConfiguration(
  inputs: Omit<DlmmInputs, "binCount" | "shape">,
  binCounts = [1, 3, 5, 9, 15, 25, 41, 69],
  shapes: LiquidityShape[] = ["spot", "curve", "bid-ask"],
): { binCount: number; shape: LiquidityShape; verdict: DlmmVerdict } {
  let best: { binCount: number; shape: LiquidityShape; verdict: DlmmVerdict } | null =
    null;
  for (const shape of shapes) {
    for (const binCount of binCounts) {
      const verdict = evaluateDlmm({ ...inputs, binCount, shape });
      if (!best || verdict.netRate > best.verdict.netRate) {
        best = { binCount, shape, verdict };
      }
    }
  }
  return best!;
}

export type SizingConfig = {
  /** Capital at the reference market cap. */
  baseCapital: number;
  /** The market cap that base sizing is calibrated to, in quote units. */
  referenceMarketCap: number;
  /** Bins at the reference market cap. */
  baseBinCount: number;
  minCapital: number;
  maxBinCount: number;
};

export const DEFAULT_SIZING: SizingConfig = {
  baseCapital: 10_000,
  referenceMarketCap: 10_000_000,
  baseBinCount: 15,
  minCapital: 250,
  maxBinCount: 69,
};

/**
 * Size and width from market cap: smaller and wider as the cap falls.
 *
 * Both legs move for the same reason. A thin book cannot absorb a large
 * position without the position becoming the book, and the same thinness means
 * price travels further per unit of flow — so the range has to cover more
 * ground to stay in range at all. Scaling with the square root keeps the
 * adjustment gradual rather than falling off a cliff between one coin and the
 * next.
 */
export function sizeForMarketCap(
  marketCap: number,
  config: SizingConfig = DEFAULT_SIZING,
): { capital: number; binCount: number } {
  if (marketCap <= 0) return { capital: 0, binCount: config.maxBinCount };

  const ratio = marketCap / config.referenceMarketCap;
  const scale = Math.sqrt(Math.min(1, ratio));

  const capital = Math.max(config.minCapital, config.baseCapital * scale);
  const binCount = Math.min(
    config.maxBinCount,
    Math.round(config.baseBinCount / Math.max(0.2, scale)),
  );

  return { capital, binCount };
}
