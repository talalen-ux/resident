/**
 * Turning a ranked board into a list of things to do, in the order to do them.
 *
 * The ordering is the substance of this module, not a detail of it. Every rule
 * here already existed and was already tested; what did not exist was anything
 * that ran them against each other, and a keeper that asks them in the wrong
 * order does the wrong thing while every individual answer is right.
 *
 *   1. Retire what has stopped earning. It frees capital, and a dead position
 *      should not be re-centred, bridged, or swept — all of which cost gas to
 *      keep something alive that is not paying for itself.
 *   2. Sweep what has accrued. Fees inside a position are exposed to the pool
 *      and the venue; fees in the vault are not, and cannot be re-centred away
 *      by accident.
 *   3. Re-centre what has drifted. Free, in the sense that it needs no bridge
 *      and no new pool, and usually the largest available uplift.
 *   4. Deploy idle capital into the best eligible pool.
 *   5. Move capital across chains, last, because it is the only decision that
 *      cannot be reversed inside one interval.
 *
 * Nothing here signs or submits. It returns intents, which the loop journals
 * before doing anything with them.
 */

import type { Scan, ScanResult } from "../sim/scanner.ts";
import { DEFAULT_SCAN, type ScanConfig } from "../sim/scanner.ts";
import { shouldRebalance, type RebalanceCost } from "../sim/rebalance.ts";
import {
  DEFAULT_RETIRE,
  DEFAULT_SWEEP,
  shouldRetire,
  shouldSweep,
  type RetireConfig,
  type SweepConfig,
} from "./sweep.ts";
import { intentId } from "./registry.ts";
import type { Intent, KeeperState } from "./types.ts";

/**
 * What the keeper has just measured about one open position.
 *
 * Separate from {@link KeeperPosition}, which is what the journal remembers.
 * This is what the chain says right now, and none of it is stored: a keeper
 * that caches its own observations will eventually act on a stale one.
 */
export type PositionObservation = {
  positionId: string;
  /** Net rate per interval WHERE THE PRICE IS NOW, in the scanner's units. */
  currentRate: number;
  /** Unswept fees inside the position, in quote units. */
  feesUnclaimed: number;
  /**
   * What the position is worth right now if closed, in quote units, EXCLUDING
   * unswept fees.
   *
   * Kept apart from the fees on purpose. Fees are income; the change in this
   * number is what the price move cost, and adding them together is how a
   * dashboard reports a position as up while its principal is bleeding.
   */
  value: number;
  /** Pool price at the observation, in quote units. */
  price: number;
  /** The last observations of currentRate, oldest first, for the retire run. */
  recentRates: number[];
  /** Bounds a re-centred position would use, from the current price. */
  freshLower: number;
  freshUpper: number;
  ageIntervals: number;
  intervalsSinceSweep: number;
};

export type DeskCosts = {
  /** Gas for one collect call, in quote units. */
  sweepGas: number;
  /** Gas for a close-and-reopen, in quote units. */
  rebalanceGas: number;
  /** Slippage on rebalancing the token ratio, as a fraction of capital. */
  rebalanceSlippage: number;
};

export type DecideConfig = {
  scan: ScanConfig;
  sweep: SweepConfig;
  retire: RetireConfig;
  costs: DeskCosts;
  /**
   * Leave this much quote uncommitted, in quote units.
   *
   * Gas has to come from somewhere, and a desk that deploys its last dollar
   * cannot afford the transaction that closes a position.
   */
  reserve: number;
  /** Do not open a position smaller than this. */
  minOpen: number;
};

export const DEFAULT_DECIDE: DecideConfig = {
  scan: DEFAULT_SCAN,
  sweep: DEFAULT_SWEEP,
  retire: DEFAULT_RETIRE,
  costs: { sweepGas: 2, rebalanceGas: 6, rebalanceSlippage: 0.001 },
  reserve: 250,
  minOpen: 250,
};

export type DecideInput = {
  state: KeeperState;
  scan: Scan;
  observations: PositionObservation[];
  /** Quote units sitting in the vault, available to commit. */
  idleCapital: number;
  /** Realised profit swept and not yet booked in the vault, in quote units. */
  unbookedProfit: number;
  /** Realised loss not yet absorbed, in quote units. */
  unbookedLoss: number;
  /** Holder entitlement not yet paid, in quote units. */
  owed: number;
  /** Distribute once owed reaches this. */
  distributeAt: number;
  now?: number;
};

export type Decision = {
  intents: Intent[];
  /** Every rule that was consulted and said no, so a quiet tick is explicable. */
  passed: { subject: string; reason: string }[];
};

/**
 * Decide what to do this interval.
 *
 * Pure: the same input always produces the same intents. Everything that talks
 * to a chain happens before this is called or after it returns, which is what
 * makes the ordering above testable at all.
 */
export function decide(
  input: DecideInput,
  config: DecideConfig = DEFAULT_DECIDE,
): Decision {
  const now = input.now ?? Date.now();
  const intents: Intent[] = [];
  const passed: { subject: string; reason: string }[] = [];

  // An unreconciled intent means a call may be in flight. Deciding anything on
  // top of that risks doubling it, so the tick stops here and says why.
  if (input.state.inFlight.length > 0) {
    return {
      intents: [],
      passed: input.state.inFlight.map((intent) => ({
        subject: intent.id,
        reason: "in flight and unreconciled; refusing to decide on top of it",
      })),
    };
  }

  const observed = new Map(input.observations.map((o) => [o.positionId, o]));
  const byPool = new Map(input.scan.ranked.map((r) => [r.pool.name, r]));

  // Positions retired or re-centred this tick are not also swept or re-entered.
  const spokenFor = new Set<string>();

  // 1. Retire.
  for (const position of input.state.positions) {
    const observation = observed.get(position.id);
    if (!observation) {
      passed.push({ subject: position.pool, reason: "not observed this tick" });
      continue;
    }
    const verdict = shouldRetire(observation.recentRates, config.retire);
    if (verdict.retire) {
      spokenFor.add(position.id);
      intents.push({
        id: intentId("close", now),
        kind: "close",
        positionId: position.id,
        reason: verdict.reason,
      });
    } else {
      passed.push({ subject: `${position.pool} retire`, reason: verdict.reason });
    }
  }

  // 2. Sweep.
  for (const position of input.state.positions) {
    if (spokenFor.has(position.id)) continue;
    const observation = observed.get(position.id);
    if (!observation) continue;
    const verdict = shouldSweep(
      observation.feesUnclaimed,
      observation.intervalsSinceSweep,
      config.costs.sweepGas,
      config.sweep,
    );
    if (verdict.sweep) {
      intents.push({
        id: intentId("sweep", now),
        kind: "sweep",
        positionId: position.id,
        reason: verdict.reason,
      });
    } else {
      passed.push({ subject: `${position.pool} sweep`, reason: verdict.reason });
    }
  }

  // 3. Re-centre.
  const cost: RebalanceCost = {
    gas: config.costs.rebalanceGas,
    slippageFraction: config.costs.rebalanceSlippage,
  };
  for (const position of input.state.positions) {
    if (spokenFor.has(position.id)) continue;
    const observation = observed.get(position.id);
    const fresh = byPool.get(position.pool);
    if (!observation || !fresh) {
      passed.push({
        subject: `${position.pool} rebalance`,
        // Not a default of "leave it": we cannot say what a fresh position here
        // would earn, and a made-up number argues for churning it.
        reason: fresh ? "not observed this tick" : "pool is not on the board",
      });
      continue;
    }
    const verdict = shouldRebalance(
      {
        name: position.pool,
        capital: position.capital,
        currentRate: observation.currentRate,
        feesUnclaimed: observation.feesUnclaimed,
        ageIntervals: observation.ageIntervals,
      },
      fresh.netRate,
      cost,
      config.scan.rebalance,
    );
    if (verdict.rebalance) {
      spokenFor.add(position.id);
      intents.push({
        id: intentId("rebalance", now),
        kind: "rebalance",
        positionId: position.id,
        lower: observation.freshLower,
        upper: observation.freshUpper,
        reason: verdict.reason,
      });
    } else {
      passed.push({
        subject: `${position.pool} rebalance`,
        reason: verdict.reason,
      });
    }
  }

  // 4. Deploy idle capital.
  const deployable = input.idleCapital - config.reserve;
  const held = new Set(input.state.positions.map((p) => p.pool));
  const target = bestOpenable(input.scan.ranked, held);

  if (!target) {
    passed.push({
      subject: "deploy",
      reason: input.scan.ranked.length
        ? "nothing on the board is both eligible and worth holding"
        : "the board is empty",
    });
  } else if (deployable < config.minOpen) {
    passed.push({
      subject: "deploy",
      reason: `${deployable.toFixed(0)} deployable after the ${config.reserve} reserve, below the ${config.minOpen} floor`,
    });
  } else {
    const capital = Math.min(deployable, target.capital);
    intents.push({
      id: intentId("open", now),
      kind: "open",
      chain: target.pool.chain,
      pool: target.pool.name,
      venueKind: target.pool.kind,
      capital,
      // Bounds come from the venue at submission time — the model chose the
      // WIDTH, and the price it is centred on must be the one at the moment the
      // position is opened, not the one this tick was priced from.
      lower: 0,
      upper: 0,
      shape: target.shape,
      binCount: target.binCount,
      reason: `${target.reason}; ${describeShape(target)}`,
    });
  }

  // 5. Cross chains.
  if (input.scan.move?.move) {
    intents.push({
      id: intentId("bridge", now),
      kind: "bridge",
      fromChain: input.scan.move.from.chain,
      toChain: input.scan.move.to.chain,
      asset: "quote",
      amount: input.scan.move.capital,
      reason: input.scan.move.reason,
    });
  } else if (input.scan.move) {
    passed.push({ subject: "bridge", reason: input.scan.move.reason });
  }

  // Vault accounting. Booking realised profit is what makes the 15% real, so it
  // is never conditional on anything the desk would rather do with the money.
  if (input.unbookedProfit > 0 || input.unbookedLoss > 0) {
    intents.push({
      id: intentId("record", now),
      kind: "record",
      realized: input.unbookedProfit,
      loss: input.unbookedLoss,
      reason: "booking swept fees and absorbed losses",
    });
  }

  if (input.owed >= input.distributeAt) {
    intents.push({
      id: intentId("distribute", now),
      kind: "distribute",
      reason: `${input.owed.toFixed(2)} owed reached the ${input.distributeAt} threshold`,
    });
  } else if (input.owed > 0) {
    passed.push({
      subject: "distribute",
      reason: `${input.owed.toFixed(2)} of ${input.distributeAt}`,
    });
  }

  return { intents, passed };
}

/** The best pool that is eligible, actually pays, and we are not already in. */
function bestOpenable(
  ranked: ScanResult[],
  held: Set<string>,
): ScanResult | null {
  for (const result of ranked) {
    if (!result.eligible) continue;
    if (result.netRate <= 0) continue;
    if (held.has(result.pool.name)) continue;
    return result;
  }
  return null;
}

function describeShape(result: ScanResult): string {
  if (result.pool.kind !== "dlmm") return "band";
  const side = result.side === "quote" ? "quote-only ladder" : "straddle";
  return `${result.binCount} bins, ${result.shape}, ${side}`;
}
