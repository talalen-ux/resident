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
 *   4. Rotate capital off a pool that has stopped working and onto one that
 *      is. Nothing else asks this, and without it the desk leaks in a way that
 *      never registers as a loss.
 *   5. Rest loose inventory above the price, where that beats holding it.
 *   6. Deploy idle capital into the best eligible pool.
 *   7. Move capital across chains, last, because it is the only decision that
 *      cannot be reversed inside one interval.
 *
 * Nothing here signs or submits. It returns intents, which the loop journals
 * before doing anything with them.
 */

import type { Scan, ScanResult } from "../sim/scanner.ts";
import { DEFAULT_SCAN, type ScanConfig } from "../sim/scanner.ts";
import { shouldRebalance, type RebalanceCost } from "../sim/rebalance.ts";
import {
  DEFAULT_ROTATION,
  rankRotations,
  type HeldPosition,
  type RotationConfig,
} from "../sim/rotate.ts";
import {
  DEFAULT_RETIRE,
  DEFAULT_SWEEP,
  shouldRetire,
  shouldSweep,
  type RetireConfig,
  type SweepConfig,
} from "./sweep.ts";
import { bestLadder } from "../sim/ladder.ts";
import { intentId } from "./registry.ts";
import type { Intent, KeeperState } from "./types.ts";
import type { ManualOrder } from "./control.ts";

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
  /**
   * Value now less cost basis, in quote units.
   *
   * Positive means closing this position books a profit. It is NOT a cost of
   * moving and never argues for holding; it only breaks a tie between two
   * rotations that are otherwise equal, because a loss has to be absorbed by
   * working capital and pauses holder accrual until it is earned back.
   */
  unrealised: number;
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
  /** When capital should leave a working pool for a better one. */
  rotation: RotationConfig;
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
  rotation: DEFAULT_ROTATION,
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
  /**
   * Tokens the desk is holding loose, per pool.
   *
   * Protocol fees arrive as the token whether or not anything is placed, so
   * inventory sitting in the vault is not neutral: it is a decision to hold.
   * A ladder is the alternative, and it is only worth placing where it beats
   * holding, which is what evaluateLadder measures.
   */
  inventory: {
    pool: string;
    /** Whole base tokens available to place. */
    quantity: number;
    /** Quote per base. */
    price: number;
  }[];
  /** Distribute once owed reaches this. */
  distributeAt: number;
  /**
   * The launch's own fees, waiting to be claimed.
   *
   * Absent when no launch is configured, which is not the same as zero: a desk
   * with no launch should say nothing about claiming rather than report that
   * there is nothing to claim.
   */
  launchFees?: {
    poolId: string;
    token: string;
    /** Already claimable out of the escrow, in quote units. */
    claimable: number;
    /** Still on the hook, which a sweep would move. An upper bound. */
    pending: number;
  };
  /**
   * Orders an operator has issued since the last tick.
   *
   * They take precedence over every rule below. An operator who has closed a
   * position knows something the price history does not, and a rule that
   * re-centres it in the same tick would be arguing with them.
   */
  manual?: ManualOrder[];
  /**
   * Stop opening anything new.
   *
   * Deliberately narrow: a paused desk still retires, sweeps and re-centres
   * what it already holds. Pausing is for "commit no more capital", and a desk
   * that also stopped tending its open positions would bleed while paused.
   */
  paused?: boolean;
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

  // 0. Manual orders.
  //
  // First, and they claim the position so nothing below revisits it. An
  // operator closing a position has a reason the rules cannot see; the rules
  // getting a second opinion in the same tick is how a manual close becomes a
  // manual close followed by an automatic re-open.
  const known = new Set(input.state.positions.map((p) => p.id));
  for (const order of input.manual ?? []) {
    if (order.kind === "close" || order.kind === "sweep") {
      if (!known.has(order.positionId)) {
        passed.push({
          subject: `manual ${order.kind}`,
          reason: `${order.positionId} is not a position this desk holds`,
        });
        continue;
      }
      spokenFor.add(order.positionId);
      intents.push({
        id: intentId(order.kind, now),
        kind: order.kind,
        positionId: order.positionId,
        reason: `manual: ${order.note}`,
      });
      continue;
    }

    if (order.kind === "open") {
      const target = byPool.get(order.pool);
      if (!target) {
        passed.push({
          subject: "manual open",
          reason: `${order.pool} is not on the board, so there is no width to place`,
        });
        continue;
      }
      // The width still comes from the model even when the entry came from a
      // person. Choosing to be in a pool is a judgement; choosing how wide to
      // sit in it is arithmetic, and doing that by hand is how a band ends up
      // one move from out of range.
      intents.push({
        id: intentId("open", now),
        kind: "open",
        chain: target.pool.chain,
        pool: target.pool.name,
        venueKind: target.pool.kind,
        capital: Math.min(order.capital, input.idleCapital),
        lower: 0,
        upper: 0,
        halfWidth: target.halfWidth,
        shape: target.shape,
        binCount: target.binCount,
        reason: `manual: ${order.note}`,
      });
    }
  }

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

  // 4. Rotate: capital sitting in a pool that has stopped working, while a
  // better one is on the board.
  //
  // After re-centring rather than before, deliberately. A drifted position on a
  // good pool is fixed by moving its range, which is one atomic call on a pool
  // the desk has already priced; rotating it would pay a round trip to solve a
  // problem the cheaper rule already solves. What rotation catches is the
  // position that is NOT drifted and is simply in the wrong pool. Nothing else catches this. Every position can
  // be above its floor, no retire rule trips, and the money is still in the
  // pool that was best when it was deployed rather than the one that is best
  // now — a leak that never shows up as a loss.
  const rotatable: HeldPosition[] = [];
  for (const position of input.state.positions) {
    if (spokenFor.has(position.id)) continue;
    const observation = observed.get(position.id);
    if (!observation) continue;
    rotatable.push({
      name: position.pool,
      chain: position.chain,
      capital: position.capital,
      currentRate: observation.currentRate,
      unrealised: observation.unrealised,
      ageIntervals: observation.ageIntervals,
    });
  }

  const rotations = rankRotations(
    rotatable,
    input.scan.ranked,
    {
      gas: config.costs.rebalanceGas,
      slippageFraction: config.costs.rebalanceSlippage,
    },
    config.rotation,
  );

  const worst = rotations[0];
  if (worst?.rotate && worst.to) {
    const position = input.state.positions.find((p) => p.pool === worst.from.name);
    if (position) {
      spokenFor.add(position.id);
      // Two intents, in order: the close frees the capital the open commits.
      // Not one atomic call, unlike re-centring — these are different pools, so
      // there is nothing to net, and a close that lands without its open leaves
      // idle capital the next tick deploys rather than a lost position.
      intents.push({
        id: intentId("close", now),
        kind: "close",
        positionId: position.id,
        reason: `rotating out: ${worst.reason}`,
      });
      intents.push({
        id: intentId("open", now),
        kind: "open",
        chain: worst.to.pool.chain,
        pool: worst.to.pool.name,
        venueKind: worst.to.pool.kind,
        capital: Math.min(position.capital, worst.to.capital),
        lower: 0,
        upper: 0,
        halfWidth: worst.to.halfWidth,
        shape: worst.to.shape,
        binCount: worst.to.binCount,
        reason: `rotating in from ${worst.from.name}: ${worst.to.reason}`,
      });
    }
  } else if (worst) {
    passed.push({ subject: `${worst.from.name} rotate`, reason: worst.reason });
  }

  // 5. Ladder loose inventory.
  //
  // Judged against HOLDING, not against cash: the tokens are in the vault
  // either way. So the question is never "is this a good pool to buy into" but
  // "does resting these above the price beat leaving them alone", which is a
  // different test and gives a different answer — most obviously on a runner,
  // where a ladder sells the whole position into the first leg and the model
  // says so rather than reporting a large fee number.
  const laddered = new Set(
    input.state.positions.filter((p) => p.kind === "ladder").map((p) => p.pool),
  );
  for (const holding of input.inventory) {
    if (laddered.has(holding.pool)) continue;
    const on = byPool.get(holding.pool);
    if (!on || !on.eligible) {
      passed.push({
        subject: `${holding.pool} ladder`,
        reason: on ? (on.blockedBy ?? "not eligible") : "pool is not on the board",
      });
      continue;
    }
    if (!(holding.quantity > 0) || !(holding.price > 0)) continue;

    const placement = bestLadder({
      volume: on.pool.volume,
      feePips: on.pool.kind === "band" ? on.pool.feePips : on.pool.feeBps * 100,
      liquidity: on.pool.kind === "band" ? on.pool.liquidity : on.pool.liquidityPerBin,
      quantity: holding.quantity,
      price: holding.price,
      volatility: on.pool.volatility,
      horizon: config.scan.rebalance.horizon,
      captureEfficiency: on.capture.efficiency,
    });

    if (placement.verdict.edgeOverHold <= 0) {
      passed.push({
        subject: `${holding.pool} ladder`,
        reason: `worse than holding: ${placement.verdict.reason}`,
      });
      continue;
    }

    intents.push({
      id: intentId("open", now),
      kind: "open",
      chain: on.pool.chain,
      pool: holding.pool,
      venueKind: "ladder",
      capital: holding.quantity * holding.price,
      lower: 0,
      upper: 0,
      halfWidth: placement.width / 2,
      gap: placement.gap,
      width: placement.width,
      quantity: holding.quantity,
      reason: `laddering inventory: ${placement.verdict.reason}`,
    });
  }

  // 6. Deploy idle capital.
  const deployable = input.paused ? 0 : input.idleCapital - config.reserve;
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
      // Bounds come from the venue at submission time. The model chose the
      // WIDTH, and the price it is centred on must be the one at the moment the
      // position is opened rather than the one this tick was priced from.
      lower: 0,
      upper: 0,
      halfWidth: target.halfWidth,
      shape: target.shape,
      binCount: target.binCount,
      reason: `${target.reason}; ${describeShape(target)}`,
    });
  }

  // 6b. Claim the launch's own fees.
  //
  // Before crossing chains and after deploying, because it is an inflow rather
  // than an allocation: what it produces is capital the NEXT tick deploys. Made
  // to clear the same gas floor a sweep does, since it is the same shape of
  // decision — a claim worth less than the gas to make it is a loss.
  if (input.launchFees) {
    const { claimable, pending, poolId, token } = input.launchFees;
    const total = claimable + pending;
    const floor = config.costs.sweepGas * config.sweep.gasMargin;
    if (total <= 0) {
      passed.push({ subject: "claim", reason: "the launch has accrued nothing" });
    } else if (total < floor) {
      passed.push({
        subject: "claim",
        reason: `${total.toFixed(2)} does not clear ${config.sweep.gasMargin}x gas (${floor.toFixed(2)})`,
      });
    } else {
      intents.push({
        id: intentId("claim", now),
        kind: "claim",
        poolId,
        token,
        expected: total,
        reason:
          `${claimable.toFixed(2)} claimable` +
          (pending > 0 ? ` and ${pending.toFixed(2)} pending on the hook` : ""),
      });
    }
  }

  // 7. Cross chains.
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
