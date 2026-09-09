/**
 * What the keeper knows about, and what it intends to do about it.
 *
 * The types here are deliberately venue-agnostic. A concentrated band on
 * Robinhood Chain and a DLMM position on Solana are different objects at the
 * RPC layer, but the keeper's decisions are the same shape for both: capital
 * committed between two prices, earning while the price is inside them. The
 * venue-specific parts live behind `handle` — an NFT token id here, a position
 * pubkey there — which the keeper stores and never interprets.
 */

import type { LiquidityShape } from "../sim/dlmm.ts";

/**
 * Which model prices this position, and therefore how it is placed.
 *
 * A ladder is its own kind rather than a band with unusual bounds, because it
 * is priced against a different baseline: a band is judged against holding
 * cash, a ladder against holding the tokens. Collapsing them would put the two
 * through one entry test, and the test is the thing that differs.
 */
export type VenueKind = "band" | "dlmm" | "ladder";

export type KeeperPosition = {
  /** Stable across restarts. Assigned when the open intent is journalled. */
  id: string;
  chain: string;
  /** Venue name as the scanner ranks it, so a position maps back to a pool. */
  pool: string;
  kind: VenueKind;
  /** Opaque venue handle: an NFT token id, a position pubkey. Never parsed. */
  handle: string;
  /** Quote units committed at open. */
  capital: number;
  /** Price bounds. For DLMM these are the outer bin prices. */
  lower: number;
  upper: number;
  /** DLMM only: the configuration bestConfiguration chose. */
  shape?: LiquidityShape;
  binCount?: number;
  /** Milliseconds since epoch. */
  openedAt: number;
  /** Fees swept out of this position so far, in quote units. */
  feesSwept: number;
  /** When fees were last swept, or openedAt if never. */
  lastSweptAt: number;
};

/**
 * Something the keeper has decided to do but has not yet confirmed.
 *
 * Every intent is journalled BEFORE it is submitted and settled after, which is
 * what makes a crash recoverable: an intent with no settlement is a call that
 * may or may not have landed, and the keeper must look at the chain rather than
 * assume either way.
 */
export type Intent =
  | {
      id: string;
      kind: "open";
      chain: string;
      pool: string;
      venueKind: VenueKind;
      capital: number;
      /**
       * Price bounds, when the caller already knows them. Zero means the
       * executor sets them from `halfWidth` at the price it actually sees,
       * which is the normal case: a band centred on a price from a tick ago is
       * a band centred on the wrong price.
       */
      lower: number;
      upper: number;
      /** Half-width as a fraction of price, from the model. */
      halfWidth: number;
      /** Ladder only: where it starts above the price, and how far it runs. */
      gap?: number;
      width?: number;
      /** Ladder only: base tokens to place, in whole units. */
      quantity?: number;
      shape?: LiquidityShape;
      binCount?: number;
      reason: string;
    }
  | { id: string; kind: "close"; positionId: string; reason: string }
  | {
      id: string;
      kind: "rebalance";
      positionId: string;
      lower: number;
      upper: number;
      reason: string;
    }
  | { id: string; kind: "sweep"; positionId: string; reason: string }
  | {
      id: string;
      kind: "bridge";
      fromChain: string;
      toChain: string;
      asset: string;
      amount: number;
      reason: string;
    }
  | {
      id: string;
      kind: "record";
      /** Quote units of realised profit to book in the vault. */
      realized: number;
      /** Quote units of realised loss to absorb against working capital. */
      loss: number;
      reason: string;
    }
  | { id: string; kind: "distribute"; reason: string };

export type IntentKind = Intent["kind"];

/** One line of the keeper's append-only journal. */
export type JournalRecord =
  | { at: number; kind: "intent"; intent: Intent }
  | {
      at: number;
      kind: "settled";
      intentId: string;
      ok: boolean;
      /** Venue handle for a settled open. */
      handle?: string;
      /** Quote units moved: fees swept, proceeds returned, capital committed. */
      amount?: number;
      txHash?: string;
      error?: string;
    }
  | {
      at: number;
      kind: "mark";
      positionId: string;
      /** Position value in quote units at `at`. */
      value: number;
      /** Fees accrued and not yet swept, in quote units. */
      feesUnclaimed: number;
      /** Pool price at the mark, in quote units. */
      price: number;
    }
  | { at: number; kind: "heartbeat"; ok: boolean; note: string }
  /**
   * A call went out and its outcome is not known yet.
   *
   * Not a settlement: the intent is still in flight after this, and replay
   * treats it as such. It exists so reconciliation can fetch one receipt
   * instead of searching the chain for a position it might not have opened.
   */
  | { at: number; kind: "broadcast"; intentId: string; txHash: string };

/** Everything the keeper believes, rebuilt by replaying the journal. */
export type KeeperState = {
  positions: KeeperPosition[];
  /** Journalled but never settled. Must be reconciled before anything else. */
  inFlight: Intent[];
  /** Fees swept across all positions, ever, in quote units. */
  sweptTotal: number;
  /** Timestamp of the last record of any kind, or 0 for an empty journal. */
  lastRecordAt: number;
  /** Timestamp of the last heartbeat that reported ok. */
  lastHealthyAt: number;
};
