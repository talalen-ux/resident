/**
 * One ranked list of LP opportunities, across chains.
 *
 * Robinhood Chain pools and Solana DLMM pools price completely differently —
 * a continuous range against discrete bins where only the active one earns —
 * so a board that ranks them on headline APR is comparing two numbers that do
 * not mean the same thing. Each venue is priced with its own model, and what
 * comes out the other side is one figure that does: the net rate per interval,
 * fees less the expected cost of the price moving.
 *
 * Ranking is the easy half. The decision is whether to act on the ranking,
 * which is what evaluateMove is for: the best venue is often not worth the
 * round trip to reach.
 */

import {
  DEFAULT_ENTRY_CONFIG,
  evaluateEntry,
  type EntryConfig,
} from "./strategy.ts";
import {
  DEFAULT_SIZING,
  bestConfiguration,
  sizeForMarketCap,
  type LiquidityShape,
  type SizingConfig,
} from "./dlmm.ts";
import {
  DEFAULT_ALLOCATION,
  bestMove,
  type AllocationConfig,
  type AllocationVerdict,
  type BridgeCost,
  type Venue,
} from "./allocate.ts";

/** A pool as the scanner sees it, whichever chain it is on. */
export type ScannedPool = {
  name: string;
  chain: string;
  /** Quote volume per interval (minute). */
  volume: number;
  /** Per-interval volatility. Required: a missing value is not a calm pool. */
  volatility: number;
  /** Market cap in quote units, for sizing. Optional. */
  marketCap?: number;
} & (
  | {
      kind: "band";
      /** Quote liquidity competing inside the band. */
      liquidity: number;
      feePips: number;
    }
  | {
      kind: "dlmm";
      binStep: number;
      feeBps: number;
      /** Quote liquidity in a typical bin. */
      liquidityPerBin: number;
    }
);

export type ScanResult = {
  pool: ScannedPool;
  venue: Venue;
  /** Capital the sizing rule would commit here. */
  capital: number;
  netRate: number;
  netApr: number;
  /** DLMM only: the width and shape that won the search. */
  binCount?: number;
  shape?: LiquidityShape;
  reason: string;
};

export type ScanConfig = {
  entry: EntryConfig;
  sizing: SizingConfig;
  allocation: AllocationConfig;
  /** Assumed fraction of the naive fee estimate actually captured. */
  captureEfficiency: number;
};

export const DEFAULT_SCAN: ScanConfig = {
  entry: DEFAULT_ENTRY_CONFIG,
  sizing: DEFAULT_SIZING,
  allocation: DEFAULT_ALLOCATION,
  // An upper bound, not a fitted value. See BandConfig.captureEfficiency.
  captureEfficiency: 1,
};

/**
 * Price one pool with the model its venue actually uses.
 *
 * Volatility of zero is rejected rather than accepted. A pool with no measured
 * volatility has no measured bleed either, so it would price as pure fee income
 * and top the board — the most dangerous possible failure, because it makes the
 * least-known pools look like the best ones.
 */
export function pricePool(
  pool: ScannedPool,
  config: ScanConfig = DEFAULT_SCAN,
): ScanResult {
  if (!(pool.volatility > 0)) {
    throw new Error(
      `${pool.name}: volatility is required. Without it the model sees no cost ` +
        "of holding, and the pool ranks top on fees alone.",
    );
  }

  const { capital } = pool.marketCap
    ? sizeForMarketCap(pool.marketCap, config.sizing)
    : { capital: config.sizing.baseCapital };

  if (pool.kind === "band") {
    const verdict = evaluateEntry(
      {
        volume: pool.volume,
        liquidity: pool.liquidity,
        feePips: pool.feePips,
        volatility: pool.volatility,
        deployed: capital,
        captureEfficiency: config.captureEfficiency,
      },
      config.entry,
    );
    return {
      pool,
      venue: { name: pool.name, chain: pool.chain, netRate: verdict.netRate },
      capital,
      netRate: verdict.netRate,
      netApr: verdict.netApr,
      reason: verdict.reason,
    };
  }

  const { binCount, shape, verdict } = bestConfiguration({
    volume: pool.volume,
    feeBps: pool.feeBps,
    binStep: pool.binStep,
    deployed: capital,
    liquidityPerBin: pool.liquidityPerBin,
    volatility: pool.volatility,
    captureEfficiency: config.captureEfficiency,
  });

  return {
    pool,
    venue: { name: pool.name, chain: pool.chain, netRate: verdict.netRate },
    capital,
    netRate: verdict.netRate,
    netApr: verdict.netApr,
    binCount,
    shape,
    reason: verdict.reason,
  };
}

export type Scan = {
  ranked: ScanResult[];
  /** Pools that could not be priced, and why. Never silently dropped. */
  skipped: { name: string; reason: string }[];
  /** What to do about it, given where the capital is now. */
  move: AllocationVerdict | null;
};

/**
 * Price every pool, rank by net rate, and say whether to act.
 *
 * `current` is where the capital sits today. Without it the ranking is just a
 * list; with it the scanner can answer the only question that matters, which is
 * whether the best pool is better by enough to pay for getting there.
 */
export function scan(
  pools: ScannedPool[],
  current: Venue | null,
  capital: number,
  bridges: Record<string, BridgeCost>,
  config: ScanConfig = DEFAULT_SCAN,
): Scan {
  const ranked: ScanResult[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const pool of pools) {
    try {
      ranked.push(pricePool(pool, config));
    } catch (error) {
      skipped.push({
        name: pool.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  ranked.sort((a, b) => b.netRate - a.netRate);

  const move = current
    ? bestMove(
        current,
        ranked.map((r) => r.venue),
        capital,
        bridges,
        config.allocation,
      )
    : null;

  return { ranked, skipped, move };
}
