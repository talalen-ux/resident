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
  type PositionSide,
  type SizingConfig,
} from "./dlmm.ts";
import {
  DEFAULT_REBALANCE,
  rangingScore,
  shouldRebalance,
  type OpenPosition,
  type RebalanceConfig,
  type RebalanceCost,
  type RebalanceVerdict,
} from "./rebalance.ts";
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
  /**
   * Recent price history, oldest first, for the ranging gate.
   *
   * Optional, and its absence is not treated as a pass: a pool with no history
   * cannot be shown to have held a band, and the gate says so rather than
   * assuming the best. See ScanConfig.requireRanging.
   */
  prices?: number[];
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
      /**
       * True for a token we are not willing to hold.
       *
       * Restricts the search to ladders placed below the price, which hold only
       * quote until the market comes down to them. It is a stance on the token,
       * not something the model should discover: a search allowed to pick
       * either side will straddle whenever straddling scores better, which on a
       * token that can go to zero is exactly the position we are refusing.
       */
      quoteOnly?: boolean;
    }
);

export type ScanResult = {
  pool: ScannedPool;
  venue: Venue;
  /** Capital the sizing rule would commit here. */
  capital: number;
  netRate: number;
  netApr: number;
  /** DLMM only: the width, shape and side that won the search. */
  binCount?: number;
  shape?: LiquidityShape;
  side?: PositionSide;
  /** How the pool scored on holding a band, or null when it has no history. */
  ranging: { containment: number; drift: number; ranging: boolean } | null;
  /** False when the board should not open here, whatever the rate says. */
  eligible: boolean;
  /** Why it is not eligible, when it is not. */
  blockedBy: string | null;
  reason: string;
};

export type ScanConfig = {
  entry: EntryConfig;
  sizing: SizingConfig;
  allocation: AllocationConfig;
  /** Assumed fraction of the naive fee estimate actually captured. */
  captureEfficiency: number;
  /**
   * Refuse to open into a pool that has not been shown to range.
   *
   * On by default. Fee rate alone ranks a token mid-collapse at the top of the
   * board — volume is enormous on the way down — and liquidity is only worth
   * providing where the price keeps coming back.
   */
  requireRanging: boolean;
  /** Band half-width the ranging test measures containment against. */
  rangingHalfWidth: number;
  /** How positions already open are judged for re-centring. */
  rebalance: RebalanceConfig;
};

export const DEFAULT_SCAN: ScanConfig = {
  entry: DEFAULT_ENTRY_CONFIG,
  sizing: DEFAULT_SIZING,
  allocation: DEFAULT_ALLOCATION,
  // An upper bound, not a fitted value. See BandConfig.captureEfficiency.
  captureEfficiency: 1,
  requireRanging: true,
  rangingHalfWidth: 0.35,
  rebalance: DEFAULT_REBALANCE,
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

  const ranging = pool.prices
    ? rangingScore(pool.prices, config.rangingHalfWidth)
    : null;

  let blockedBy: string | null = null;
  if (config.requireRanging) {
    if (!ranging) {
      blockedBy = "no price history to test whether it ranges";
    } else if (!ranging.ranging) {
      blockedBy =
        `trending: ${(ranging.containment * 100).toFixed(0)}% inside the band, ` +
        `${(ranging.drift * 100).toFixed(0)}% drift`;
    }
  }
  const eligible = blockedBy === null;

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
      ranging,
      eligible,
      blockedBy,
      reason: verdict.reason,
    };
  }

  const { binCount, shape, side, verdict } = bestConfiguration(
    {
      volume: pool.volume,
      feeBps: pool.feeBps,
      binStep: pool.binStep,
      deployed: capital,
      liquidityPerBin: pool.liquidityPerBin,
      volatility: pool.volatility,
      captureEfficiency: config.captureEfficiency,
    },
    undefined,
    undefined,
    pool.quoteOnly ? ["quote"] : ["both"],
  );

  return {
    pool,
    venue: { name: pool.name, chain: pool.chain, netRate: verdict.netRate },
    capital,
    netRate: verdict.netRate,
    netApr: verdict.netApr,
    binCount,
    shape,
    side,
    ranging,
    eligible,
    blockedBy,
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

  // Only eligible venues are candidates. A trending pool at the top of the
  // board is exactly the move the allocator must not make, and filtering here
  // rather than inside bestMove keeps the ranking honest: the pool still
  // appears, with the reason it was passed over.
  const move = current
    ? bestMove(
        current,
        ranked.filter((r) => r.eligible).map((r) => r.venue),
        capital,
        bridges,
        config.allocation,
      )
    : null;

  return { ranked, skipped, move };
}

/**
 * What to do about the positions already open.
 *
 * The ranking answers "where should capital be". This answers the question that
 * comes first and is easier to forget: a position we already hold may have
 * drifted off the price and quietly stopped earning, and re-centring it on the
 * same pool can beat anything on the board without a bridge, a new pool, or a
 * decision about a token we have not held before.
 *
 * A position whose pool is no longer in the scan gets no verdict rather than a
 * default one — we cannot say what a fresh position there would earn, and
 * inventing a number would argue for churning it.
 */
export function reviewPositions(
  open: OpenPosition[],
  ranked: ScanResult[],
  cost: RebalanceCost,
  config: ScanConfig = DEFAULT_SCAN,
): { position: OpenPosition; verdict: RebalanceVerdict | null }[] {
  const byPool = new Map(ranked.map((r) => [r.pool.name, r]));
  return open.map((position) => {
    const fresh = byPool.get(position.name);
    return {
      position,
      verdict: fresh
        ? shouldRebalance(position, fresh.netRate, cost, config.rebalance)
        : null,
    };
  });
}
