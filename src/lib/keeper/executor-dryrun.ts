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
};

export function dryRunExecutor(options: DryRunOptions = {}) {
  let sequence = 0;
  const assumed = options.assumedSweepFraction ?? 0;

  return async (
    intent: Intent,
  ): Promise<{ handle?: string; amount?: number; txHash?: string }> => {
    sequence++;
    const txHash = `dry:${intent.kind}:${sequence}`;

    switch (intent.kind) {
      case "open":
        return { handle: `dry:${sequence}`, amount: intent.capital, txHash };
      case "rebalance":
        return { handle: `dry:${sequence}`, txHash };
      case "sweep":
        // Zero unless the caller says otherwise. A dry run that invents fee
        // income produces a journal that looks profitable and proves nothing.
        return { amount: assumed, txHash };
      case "close":
        return { amount: 0, txHash };
      default:
        return { txHash };
    }
  };
}
