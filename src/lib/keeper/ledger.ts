/**
 * Every position the desk has ever held, and what it actually made.
 *
 * A live dashboard says what is happening now. A ledger says what happened, and
 * it is the stronger claim: a stranger with the journal and a block explorer
 * can reconstruct each position, check the transactions against the chain, and
 * arrive at the same total. That is a different thing from being asked to
 * believe a headline number, and it is the thing that cannot be faked by a
 * pretty card.
 *
 * WHAT IS AND IS NOT COUNTED
 *
 * Realised is only for closed positions: capital out, plus every fee swept,
 * less capital in. Nothing about it is an estimate. An open position gets an
 * unrealised figure instead, marked at its last observed value, and the two are
 * never added into one number without saying which is which — combining them is
 * how a set of open losers gets reported as a flat month.
 */

import type { Intent, JournalRecord } from "./types.ts";

export type LedgerEntry = {
  positionId: string;
  chain: string;
  pool: string;
  openedAt: number;
  closedAt: number | null;
  /** Quote units that actually reached the pool. */
  capitalIn: number;
  /** Quote units returned when it closed, or null while open. */
  proceedsOut: number | null;
  /** Every fee sweep out of this position, in quote units. */
  feesSwept: number;
  /** Last marked value, for an open position. Null when never marked. */
  markedValue: number | null;
  /** Unswept fees at the last mark. */
  markedFees: number | null;
  /** proceeds + fees − capital, for a closed position. Null while open. */
  realised: number | null;
  /** marked + fees − capital, for an open one. Null when never marked. */
  unrealised: number | null;
  /** How many times it was re-centred. */
  rebalances: number;
  /** Every transaction that touched it, in order. */
  txHashes: string[];
};

/**
 * Rebuild the ledger from the journal.
 *
 * Positions appear here from the moment their open settles, closed ones
 * included — the point of a ledger is that nothing leaves it.
 */
export function ledgerFrom(records: JournalRecord[]): LedgerEntry[] {
  const entries = new Map<string, LedgerEntry>();
  const intents = new Map<string, Intent>();

  for (const record of records) {
    if (record.kind === "intent") {
      intents.set(record.intent.id, record.intent);
      continue;
    }

    if (record.kind === "mark") {
      const entry = entries.get(record.positionId);
      if (entry && entry.closedAt === null) {
        entry.markedValue = record.value;
        entry.markedFees = record.feesUnclaimed;
      }
      continue;
    }

    if (record.kind !== "settled" || !record.ok) continue;

    const intent = intents.get(record.intentId);
    if (!intent) continue;
    if (record.txHash) {
      const target =
        intent.kind === "open"
          ? intent.id
          : "positionId" in intent
            ? intent.positionId
            : null;
      const entry = target ? entries.get(target) : null;
      if (entry) entry.txHashes.push(record.txHash);
    }

    if (intent.kind === "open") {
      const entry: LedgerEntry = {
        positionId: intent.id,
        chain: intent.chain,
        pool: intent.pool,
        openedAt: record.at,
        closedAt: null,
        capitalIn: record.amount ?? intent.capital,
        proceedsOut: null,
        feesSwept: 0,
        markedValue: null,
        markedFees: null,
        realised: null,
        unrealised: null,
        rebalances: 0,
        txHashes: record.txHash ? [record.txHash] : [],
      };
      entries.set(intent.id, entry);
      continue;
    }

    const entry = "positionId" in intent ? entries.get(intent.positionId) : null;
    if (!entry) continue;

    if (intent.kind === "sweep") {
      entry.feesSwept += record.amount ?? 0;
    } else if (intent.kind === "rebalance") {
      entry.rebalances++;
      // Re-centring returns capital and commits it again. The ledger tracks the
      // capital that is in the pool now, so the entry follows the new amount
      // rather than pretending the original size is still deployed.
      if (record.amount !== undefined) entry.capitalIn = record.amount;
    } else if (intent.kind === "close") {
      entry.closedAt = record.at;
      // An absent amount means nobody observed the proceeds, which is not the
      // same as proceeds of zero. Recording zero here books the position as a
      // total loss, and a dry run would report every close that way.
      entry.proceedsOut = record.amount ?? null;
    }
  }

  for (const entry of entries.values()) {
    if (entry.closedAt !== null && entry.proceedsOut !== null) {
      entry.realised = entry.proceedsOut + entry.feesSwept - entry.capitalIn;
    } else if (entry.markedValue !== null) {
      entry.unrealised =
        entry.markedValue +
        (entry.markedFees ?? 0) +
        entry.feesSwept -
        entry.capitalIn;
    }
  }

  return [...entries.values()].sort((a, b) => a.openedAt - b.openedAt);
}

export type LedgerTotals = {
  positions: number;
  closed: number;
  /** Closed with proceeds nobody observed. Excluded from `realised`. */
  unpriced: number;
  open: number;
  feesSwept: number;
  /** Sum over closed positions. Includes losses; that is the point. */
  realised: number;
  /** Sum over open positions, marked. Reported apart from realised, always. */
  unrealised: number;
  /** Closed positions that made money. */
  winners: number;
  losers: number;
};

/**
 * The totals, with realised and unrealised kept apart.
 *
 * They are returned as separate fields rather than a sum, and callers that want
 * one number have to write the addition themselves. That is deliberate: adding
 * an unrealised mark to a realised result produces a figure that moves with the
 * market and reads like a bank balance.
 */
export function ledgerTotals(entries: LedgerEntry[]): LedgerTotals {
  // Closed by the fact of closing, not by whether a number came back with it.
  // Keying on realised would file every unpriced close under "open".
  const closed = entries.filter((e) => e.closedAt !== null);
  const priced = closed.filter((e) => e.realised !== null);
  const open = entries.filter((e) => e.closedAt === null);

  return {
    positions: entries.length,
    closed: closed.length,
    unpriced: closed.length - priced.length,
    open: open.length,
    feesSwept: entries.reduce((total, e) => total + e.feesSwept, 0),
    realised: priced.reduce((total, e) => total + (e.realised ?? 0), 0),
    unrealised: open.reduce((total, e) => total + (e.unrealised ?? 0), 0),
    winners: priced.filter((e) => (e.realised ?? 0) > 0).length,
    losers: priced.filter((e) => (e.realised ?? 0) < 0).length,
  };
}
