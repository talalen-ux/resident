/**
 * An executor that carries nothing out.
 *
 * It answers every intent with a synthetic handle so the loop runs end to end
 * and the journal fills with what the keeper WOULD have done. That journal is
 * the point: left running against a live RPC for a week it produces a record
 * of every position the desk would have opened, every sweep, every re-centre —
 * which can be checked against what those pools actually paid before a key
 * exists anywhere.
 *
 * The handles are prefixed `dry:` so a dry-run journal can never be mistaken
 * for a real one, by a person or by the reconciler.
 */

import type { Intent } from "./types.ts";

export type DryRunOptions = {
  /** Fees a sweep is assumed to return, as a fraction of position capital. */
  assumedSweepFraction?: number;
  /**
   * What a position is worth, for a caller that knows.
   *
   * A dry run cannot observe proceeds, and answering zero is not a neutral
   * placeholder: the ledger books proceeds less capital, so a zero reads as
   * losing the entire position. A paper book does know the value — it marks
   * against real prices — so it supplies this and gets an honest close.
   */
  proceedsOf?: (positionId: string) => number | undefined;
  /**
   * The pool's price now, so an open can be centred on it.
   *
   * An open intent carries a half-width and zero bounds, because a band must be
   * centred at submission rather than on a price from a tick ago. A dry run
   * that does not resolve them stores a position with lower and upper of zero,
   * and every mark against it comes out NaN — which reads as a position that
   * earns nothing, gets retired, and is reopened forever.
   */
  priceOf?: (pool: string) => number | undefined;
  /**
   * Fees a position has accrued, for a caller that tracks them.
   *
   * Without it a sweep settles for zero: the fees leave the position, nothing
   * is credited to cash, and the book quietly loses every fee it ever earned
   * while reporting that it swept 38 times.
   */
  feesOf?: (positionId: string) => number | undefined;
};

export function dryRunExecutor(options: DryRunOptions = {}) {
  let sequence = 0;
  const assumed = options.assumedSweepFraction ?? 0;

  return async (
    intent: Intent,
  ): Promise<{ handle?: string; amount?: number; txHash?: string; lower?: number; upper?: number }> => {
    sequence++;
    const txHash = `dry:${intent.kind}:${sequence}`;

    switch (intent.kind) {
      case "open": {
        const price = options.priceOf?.(intent.pool);
        const half = intent.halfWidth ?? 0;
        const bounds =
          price !== undefined && price > 0 && half > 0
            ? { lower: price * (1 - half), upper: price * (1 + half) }
            : { lower: intent.lower, upper: intent.upper };
        return { handle: `dry:${sequence}`, amount: intent.capital, txHash, ...bounds };
      }
      case "rebalance":
        return { handle: `dry:${sequence}`, txHash };
      case "sweep": {
        // Zero unless the caller says otherwise. A dry run that invents fee
        // income produces a journal that looks profitable and proves nothing.
        // A paper book is not inventing: it has been accruing the model's own
        // estimate mark by mark, and this returns what it accrued.
        const fees = options.feesOf?.(intent.positionId);
        return { amount: fees ?? assumed, txHash };
      }
      case "close": {
        // Undefined, not zero, when nothing knows. The ledger leaves an
        // unpriced close unrealised rather than booking it as a wipeout.
        const value = options.proceedsOf?.(intent.positionId);
        return value === undefined ? { txHash } : { amount: value, txHash };
      }
      default:
        return { txHash };
    }
  };
}
