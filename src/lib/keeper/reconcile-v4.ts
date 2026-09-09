/**
 * Answering "did it land" for Robinhood Chain.
 *
 * An intent left in flight is a call that was broadcast and never accounted
 * for. The keeper is not allowed to decide anything on top of one, so this runs
 * first and has to give a real answer.
 *
 * It is a receipt lookup rather than a search, because the broadcast hash was
 * written to the journal at the moment the outcome became unknown. Without that
 * record this would have to hunt the chain for a position that may never have
 * been minted, and would have to guess when it came up empty.
 *
 * There are three answers and no fourth. Landed: the handle comes out of the
 * logs. Reverted, or never broadcast: not found, and the intent is closed out.
 * Still pending: this THROWS, which stops the keeper. That is correct — a
 * transaction that is still in the mempool may yet mine, and treating it as
 * either outcome is how the same position gets opened twice.
 */

import type { Journal, Reconciler } from "./registry.ts";
import type { Intent, JournalRecord } from "./types.ts";
import { tokenIdFromLogs, type RawLog } from "./executor-v4.ts";

export type ReceiptLookup = (
  txHash: string,
) => Promise<{ ok: boolean; logs: RawLog[] } | null>;

/** The last hash broadcast for an intent, or null if none ever was. */
export function broadcastFor(
  records: JournalRecord[],
  intentId: string,
): string | null {
  let hash: string | null = null;
  for (const record of records) {
    if (record.kind === "broadcast" && record.intentId === intentId) {
      hash = record.txHash;
    }
  }
  return hash;
}

export function makeV4Reconciler(deps: {
  journal: Journal;
  receipt: ReceiptLookup;
  positionManager: string;
  vault: string;
}): Reconciler {
  return async (intent: Intent) => {
    const records = await deps.journal.read();
    const hash = broadcastFor(records, intent.id);

    if (!hash) {
      // Nothing was ever broadcast for this intent, so nothing happened. The
      // journal is written before the call, so this is a real answer and not an
      // absence of evidence.
      return { found: null };
    }

    const receipt = await deps.receipt(hash);
    if (receipt === null) {
      throw new Error(
        `${intent.id}: ${hash} is not mined yet. Refusing to decide anything ` +
          "while a call that may still land is outstanding.",
      );
    }

    if (!receipt.ok) return { found: null, txHash: hash };

    if (intent.kind === "open" || intent.kind === "rebalance") {
      const tokenId = tokenIdFromLogs(
        receipt.logs,
        deps.positionManager,
        deps.vault,
      );
      if (tokenId === null) {
        // Mined, succeeded, and no position came to the vault. Whatever that
        // transaction did, it did not open one.
        return { found: null, txHash: hash };
      }
      return { found: tokenId.toString(), txHash: hash };
    }

    // Everything else has no handle of its own; that it mined is the answer.
    return { found: hash, txHash: hash };
  };
}
