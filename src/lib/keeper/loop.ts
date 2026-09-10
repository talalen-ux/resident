/**
 * One interval of the keeper.
 *
 * Read the chain, reconcile anything left in flight, price the board, decide,
 * journal, submit. The tick is deliberately a single function that returns a
 * report rather than a long-running process: the process is a `while` loop
 * around it in a script, and everything worth testing is in here.
 *
 * The order at the top is not negotiable. Reconciliation comes before the
 * decision because an intent that may have landed makes every subsequent
 * decision unsafe; the journal write comes before the call because the reverse
 * order is how a keeper loses track of a position it owns.
 */

import type { Scan } from "../sim/scanner.ts";
import { scan as runScan, type ScannedPool } from "../sim/scanner.ts";
import type { BridgeCost, Venue } from "../sim/allocate.ts";
import {
  type Journal,
  type Reconciler,
  loadState,
  reconcile,
  submit,
} from "./registry.ts";
import { checkSigner, type Signer } from "./signer.ts";
import { DEFAULT_DECIDE, decide, type DecideConfig, type PositionObservation } from "./decide.ts";
import type { ManualOrder } from "./control.ts";
import type { Intent, KeeperState } from "./types.ts";

/** Everything the tick reads from outside itself. */
export type Observation = {
  /** The board, priced from live volume, liquidity and volatility. */
  pools: ScannedPool[];
  /** One entry per open position the keeper believes it holds. */
  positions: PositionObservation[];
  /** Orders an operator issued since the last tick. Drained by observe(). */
  manual?: ManualOrder[];
  /** Commit no new capital. Open positions are still tended. */
  paused?: boolean;
  /** Where the capital sits now, or null when nothing is deployed. */
  current: Venue | null;
  /** Uncommitted quote in the vault. */
  idleCapital: number;
  /**
   * Loose tokens in the vault, per pool.
   *
   * Protocol fees arrive as the token, so this is never empty on a running
   * desk. Leaving it empty is a decision to hold everything.
   */
  inventory: { pool: string; quantity: number; price: number }[];
  unbookedProfit: number;
  unbookedLoss: number;
  owed: number;
  /** Cost of crossing to each chain, keyed by chain name. */
  bridges: Record<string, BridgeCost>;
  /** The vault's owner and keeper, read fresh, for the signer check. */
  vault: { owner: string; keeper: string };
};

export interface KeeperDeps {
  /** Read everything this tick needs, in as few round trips as possible. */
  observe(state: KeeperState): Promise<Observation>;
  /** Carry out one intent. Throws Unconfirmed if it cannot say whether it landed. */
  execute(intent: Intent): Promise<{
    handle?: string;
    amount?: number;
    txHash?: string;
  }>;
  /** Look up what an in-flight intent actually did. */
  reconcile: Reconciler;
  signer: Signer;
}

export type TickReport = {
  at: number;
  /** In-flight intents settled against the chain before deciding. */
  reconciled: number;
  scan: Scan | null;
  intents: Intent[];
  /** Intents that were submitted, and how they went. */
  results: { intent: Intent; ok: boolean; error?: string }[];
  passed: { subject: string; reason: string }[];
  /** Set when the tick refused to act, with the reason. Never silent. */
  halted: string | null;
};

export type TickConfig = {
  decide: DecideConfig;
  /** Distribute to holders once this much is owed, in quote units. */
  distributeAt: number;
};

export const DEFAULT_TICK: TickConfig = {
  decide: DEFAULT_DECIDE,
  // Matches the figure published in the docs. The two are bound together by a
  // test, so moving one without the other fails the build rather than quietly
  // making the page wrong.
  distributeAt: 300,
};

/**
 * Run one interval.
 *
 * Never throws for an ordinary failure — a bad RPC, a reverted call, a signer
 * that is not the keeper all come back as a report with `halted` set or a
 * result marked not ok. A keeper that crashes on a transient read is a keeper
 * that is not running when the thing it was watching for happens.
 */
export async function tick(
  deps: KeeperDeps,
  journal: Journal,
  config: TickConfig = DEFAULT_TICK,
  now = () => Date.now(),
): Promise<TickReport> {
  const at = now();
  const report: TickReport = {
    at,
    reconciled: 0,
    scan: null,
    intents: [],
    results: [],
    passed: [],
    halted: null,
  };

  let state: KeeperState;
  let observation: Observation;
  try {
    state = await loadState(journal);
    observation = await deps.observe(state);
  } catch (error) {
    report.halted = `could not read: ${message(error)}`;
    await journal.append({ at, kind: "heartbeat", ok: false, note: report.halted });
    return report;
  }

  // The vault's keeper can be rotated under a running process, so this is
  // checked every tick against what the chain says now, not once at startup.
  if (!deps.signer.dryRun) {
    const check = checkSigner(await deps.signer.address(), observation.vault);
    if (!check.ok) {
      report.halted = check.problems.join(" ");
      await journal.append({ at, kind: "heartbeat", ok: false, note: report.halted });
      return report;
    }
  }

  if (state.inFlight.length > 0) {
    try {
      report.reconciled = await reconcile(journal, state, deps.reconcile, at);
      state = await loadState(journal);
    } catch (error) {
      // An intent nobody can account for stops the keeper. Carrying on past it
      // is how the same position gets opened twice.
      report.halted = `could not reconcile: ${message(error)}`;
      await journal.append({ at, kind: "heartbeat", ok: false, note: report.halted });
      return report;
    }
  }

  const scanned = runScan(
    observation.pools,
    observation.current,
    observation.idleCapital,
    observation.bridges,
    config.decide.scan,
  );
  report.scan = scanned;

  // Mark every open position before deciding. The marks are what make "net"
  // a measured figure later rather than a claim, and they must be written even
  // on a tick where nothing else happens.
  for (const position of observation.positions) {
    if (!state.positions.some((p) => p.id === position.positionId)) continue;
    await journal.append({
      at,
      kind: "mark",
      positionId: position.positionId,
      value: position.value,
      feesUnclaimed: position.feesUnclaimed,
      price: position.price,
    });
  }

  const decision = decide(
    {
      state,
      scan: scanned,
      observations: observation.positions,
      manual: observation.manual,
      paused: observation.paused,
      idleCapital: observation.idleCapital,
      inventory: observation.inventory,
      unbookedProfit: observation.unbookedProfit,
      unbookedLoss: observation.unbookedLoss,
      owed: observation.owed,
      distributeAt: config.distributeAt,
      now: at,
    },
    config.decide,
  );
  report.intents = decision.intents;
  report.passed = decision.passed;

  for (const intent of decision.intents) {
    const result = await submit(journal, intent, deps.execute, now);
    report.results.push({ intent, ok: result.ok, error: result.error });
    if (result.unresolved) {
      // Everything after this would be decided on top of a call that may be
      // mining. Stop, and let the next tick reconcile it.
      report.halted = `${intent.kind} is unresolved: ${result.error}`;
      break;
    }
  }

  await journal.append({
    at,
    kind: "heartbeat",
    ok: report.halted === null,
    note:
      report.halted ??
      `${decision.intents.length} intents, ${scanned.ranked.length} pools ranked`,
  });

  return report;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
