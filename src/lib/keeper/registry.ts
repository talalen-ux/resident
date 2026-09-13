/**
 * What the keeper owns, rebuilt from an append-only journal.
 *
 * THE FAILURE THIS EXISTS TO PREVENT
 *
 * A keeper that holds its positions in memory and writes them out afterwards
 * will, the first time it dies between submitting a transaction and recording
 * it, come back believing it holds nothing — and open the position again. Two
 * positions where the sizing rule allowed one, on capital that is not ours.
 *
 * So nothing is remembered that was not written down first. Every intent is
 * journalled BEFORE submission and settled after. On restart the journal is
 * replayed, and any intent without a settlement is returned as in-flight: a
 * call that may or may not have landed. The keeper is required to look at the
 * chain for those before it is allowed to decide anything new — {@link
 * reconcile} refuses to clear one on assumption.
 *
 * The journal is the record. The state is a projection of it, and can always be
 * thrown away and rebuilt.
 */

import type {
  Intent,
  JournalRecord,
  KeeperPosition,
  KeeperState,
} from "./types.ts";

/**
 * Somewhere to append records and read them back in order.
 *
 * An interface rather than a file path so the loop can be tested without
 * touching a disk, and so a deployment can put the journal somewhere durable
 * without the keeper knowing.
 */
export interface Journal {
  append(record: JournalRecord): Promise<void>;
  read(): Promise<JournalRecord[]>;
}

/** A journal held in memory. Loses everything on exit — tests and dry runs. */
export class MemoryJournal implements Journal {
  private records: JournalRecord[] = [];

  async append(record: JournalRecord): Promise<void> {
    this.records.push(record);
  }

  async read(): Promise<JournalRecord[]> {
    return [...this.records];
  }
}

/**
 * Rebuild the keeper's belief from the journal.
 *
 * Records are applied in the order they were written. An unknown record kind is
 * ignored rather than fatal: a journal written by a later version of the keeper
 * should still replay into a usable state on an older one.
 */
export function replay(records: JournalRecord[]): KeeperState {
  const positions = new Map<string, KeeperPosition>();
  const pending = new Map<string, Intent>();
  let sweptTotal = 0;
  let lastRecordAt = 0;
  let lastHealthyAt = 0;

  for (const record of records) {
    lastRecordAt = Math.max(lastRecordAt, record.at);

    if (record.kind === "intent") {
      pending.set(record.intent.id, record.intent);
      continue;
    }

    if (record.kind === "heartbeat") {
      if (record.ok) lastHealthyAt = Math.max(lastHealthyAt, record.at);
      continue;
    }

    // Neither of these settles anything. A broadcast says a hash exists to look
    // up, which is exactly why the intent stays in flight.
    if (record.kind === "mark" || record.kind === "broadcast") continue;

    if (record.kind !== "settled") continue;

    const intent = pending.get(record.intentId);
    pending.delete(record.intentId);
    // A settlement for an intent we never journalled means the journal is
    // truncated. Dropping it silently is right: the projection cannot invent
    // the position, and reconcile will surface whatever is actually on chain.
    if (!intent || !record.ok) continue;

    if (intent.kind === "open") {
      positions.set(intent.id, {
        id: intent.id,
        chain: intent.chain,
        pool: intent.pool,
        kind: intent.venueKind,
        handle: record.handle ?? "",
        capital: record.amount ?? intent.capital,
        // What the venue used, falling back to what was asked for. A position
        // recorded with zero bounds cannot be marked at all.
        lower: record.lower ?? intent.lower,
        upper: record.upper ?? intent.upper,
        shape: intent.shape,
        binCount: intent.binCount,
        openedAt: record.at,
        feesSwept: 0,
        lastSweptAt: record.at,
        probe: intent.probe,
      });
    } else if (intent.kind === "close") {
      positions.delete(intent.positionId);
    } else if (intent.kind === "rebalance") {
      const position = positions.get(intent.positionId);
      if (position) {
        // Re-centring keeps the position's identity and history: it is the same
        // capital on the same pool, moved. A new id here would break the ledger
        // into unrelated fragments and lose the age the rebalance gate reads.
        position.lower = intent.lower;
        position.upper = intent.upper;
        position.handle = record.handle ?? position.handle;
        if (record.amount !== undefined) position.capital = record.amount;
      }
    } else if (intent.kind === "sweep") {
      const position = positions.get(intent.positionId);
      const amount = record.amount ?? 0;
      sweptTotal += amount;
      if (position) {
        position.feesSwept += amount;
        position.lastSweptAt = record.at;
      }
    } else if (intent.kind === "claim") {
      // Income banked from the launch's own fees, not from a position.
      //
      // It counts here for the same reason a sweep does: sweptTotal is what
      // the desk has actually realised, and the record intent books the
      // difference between that and the vault's ledger. Leaving claims out
      // would mean the launch's fees — the largest income the desk has —
      // never reached the contract as profit, so holders never accrued a cent
      // of the 15% against them.
      sweptTotal += record.amount ?? 0;
    }
  }

  return {
    positions: [...positions.values()],
    inFlight: [...pending.values()],
    sweptTotal,
    lastRecordAt,
    lastHealthyAt,
  };
}

/** Read the journal and project it. */
export async function loadState(journal: Journal): Promise<KeeperState> {
  return replay(await journal.read());
}

/**
 * What an in-flight intent turned out to have done, found by looking.
 *
 * `found` is the venue handle when the call landed, and null when it did not.
 * There is no third answer and no default: a resolver that cannot tell must
 * throw, because guessing here is exactly the double-entry this module exists
 * to prevent.
 */
export type Reconciler = (intent: Intent) => Promise<{
  found: string | null;
  amount?: number;
  txHash?: string;
}>;

/**
 * Settle every in-flight intent against what the chain actually shows.
 *
 * Returns the number reconciled. Throws if the resolver throws — an unresolved
 * intent must stop the keeper, not be stepped over. A keeper that carries on
 * past an intent it cannot account for is a keeper that will open the position
 * twice.
 */
export async function reconcile(
  journal: Journal,
  state: KeeperState,
  resolve: Reconciler,
  now = Date.now(),
): Promise<number> {
  for (const intent of state.inFlight) {
    const outcome = await resolve(intent);
    await journal.append({
      at: now,
      kind: "settled",
      intentId: intent.id,
      ok: outcome.found !== null,
      handle: outcome.found ?? undefined,
      amount: outcome.amount,
      txHash: outcome.txHash,
      error: outcome.found === null ? "not found on chain" : undefined,
    });
  }
  return state.inFlight.length;
}

let counter = 0;

/**
 * An id for one intent.
 *
 * Time plus a counter rather than a random value, so a journal read by a human
 * sorts in the order things were attempted.
 */
export function intentId(kind: string, now = Date.now()): string {
  counter = (counter + 1) % 1_000_000;
  return `${kind}-${now.toString(36)}-${counter.toString(36)}`;
}

/**
 * Raised by an executor that submitted a call but cannot say whether it landed.
 *
 * This is the one outcome that must NOT be written down as a failure. A dropped
 * confirmation, an RPC timeout after broadcast, a node that went away mid-call:
 * the transaction may be mining right now. Recording it as failed would leave a
 * real position with no entry in the registry, and the next tick would open it
 * again. Leaving the intent in flight forces reconcile to go and look, which is
 * the only honest answer available.
 */
export class Unconfirmed extends Error {
  /**
   * The transaction that was broadcast, when there is one.
   *
   * Without it, reconciling an in-flight intent means searching the chain for
   * something that may not be there. With it, the next tick fetches one receipt
   * and knows. It is journalled separately from the settlement precisely
   * because the intent is NOT settled.
   */
  readonly txHash: string | undefined;

  constructor(message: string, txHash?: string) {
    super(message);
    this.name = "Unconfirmed";
    this.txHash = txHash;
  }
}

/** Journal an intent, run it, and journal what happened. Never one without the other. */
export async function submit(
  journal: Journal,
  intent: Intent,
  execute: (intent: Intent) => Promise<{
    handle?: string;
    amount?: number;
    txHash?: string;
    /** Bounds the venue chose, when it centred the band itself. */
    lower?: number;
    upper?: number;
  }>,
  now = () => Date.now(),
): Promise<{ ok: boolean; error?: string; unresolved?: boolean }> {
  await journal.append({ at: now(), kind: "intent", intent });
  try {
    const result = await execute(intent);
    await journal.append({
      at: now(),
      kind: "settled",
      intentId: intent.id,
      ok: true,
      handle: result.handle,
      amount: result.amount,
      lower: result.lower,
      upper: result.upper,
      txHash: result.txHash,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Unconfirmed) {
      // Deliberately no SETTLEMENT record: the intent stays in flight and the
      // next reconcile has to look at the chain before the keeper decides
      // anything else. What is written down is the hash, which is not a
      // settlement and does not resolve anything — it is the difference between
      // reconciling by fetching one receipt and reconciling by searching.
      if (error.txHash) {
        await journal.append({
          at: now(),
          kind: "broadcast",
          intentId: intent.id,
          txHash: error.txHash,
        });
      }
      return { ok: false, error: message, unresolved: true };
    }
    // A call that failed to submit did nothing, so closing the intent out here
    // is safe and keeps it from coming back as in-flight on the next start.
    await journal.append({
      at: now(),
      kind: "settled",
      intentId: intent.id,
      ok: false,
      error: message,
    });
    return { ok: false, error: message };
  }
}
