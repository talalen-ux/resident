/**
 * When to collect fees, and when to give up on a position.
 *
 * SWEEPING
 *
 * Two thresholds, whichever comes first: enough fees to be worth a transaction,
 * or enough time that leaving them uncollected is its own risk. Uncollected
 * fees sit inside the position, which means they are exposed to the pool, the
 * venue contract, and anything that goes wrong with either. Collecting them
 * turns a claim into a balance.
 *
 * There is a third condition the two-threshold rule needs and does not have on
 * its own: a sweep costs gas, and the time rule will fire on a pool that earned
 * almost nothing. Sweeping $2 of fees for $6 of gas is a loss taken on purpose.
 * So the amount must clear the cost of collecting it, whichever threshold fired
 * — which means a dead position simply stops being swept rather than being
 * drained a few dollars at a time.
 *
 * RETIRING
 *
 * A position that has stopped paying should be closed, but not on one bad
 * reading. Fee rates are noisy over short windows, and a pool that looks dead
 * for ten minutes on a quiet afternoon is not dead. Retirement requires the net
 * rate — the same figure the scanner ranks on, fees less expected bleed — to
 * sit under the floor for a run of consecutive observations.
 */

export type SweepConfig = {
  /** Collect once unclaimed fees reach this, in quote units. */
  minAmount: number;
  /** Collect anyway after this many intervals, if the amount clears gas. */
  maxIntervals: number;
  /**
   * Multiple of gas the swept amount must clear.
   *
   * At 1.0 a sweep that exactly pays for itself is allowed, which is a
   * transaction taken for nothing. Above 1 there has to be something left.
   */
  gasMargin: number;
};

export const DEFAULT_SWEEP: SweepConfig = {
  minAmount: 100,
  maxIntervals: 15,
  gasMargin: 3,
};

export type SweepVerdict = {
  sweep: boolean;
  reason: string;
};

/**
 * Should this position's fees be collected now?
 *
 * `intervalsSinceSweep` is in the same interval the rest of the desk uses —
 * minutes — so the time rule reads as minutes without a unit conversion nobody
 * would notice was wrong.
 */
export function shouldSweep(
  feesUnclaimed: number,
  intervalsSinceSweep: number,
  gasCost: number,
  config: SweepConfig = DEFAULT_SWEEP,
): SweepVerdict {
  const floor = gasCost * config.gasMargin;

  if (feesUnclaimed <= 0) {
    return { sweep: false, reason: "nothing accrued" };
  }
  if (feesUnclaimed < floor) {
    return {
      sweep: false,
      reason: `${feesUnclaimed.toFixed(2)} does not clear ${config.gasMargin}x gas (${floor.toFixed(2)})`,
    };
  }
  if (feesUnclaimed >= config.minAmount) {
    return {
      sweep: true,
      reason: `${feesUnclaimed.toFixed(2)} reached the ${config.minAmount} threshold`,
    };
  }
  if (intervalsSinceSweep >= config.maxIntervals) {
    return {
      sweep: true,
      reason: `${intervalsSinceSweep} intervals since the last sweep`,
    };
  }
  return {
    sweep: false,
    reason: `${feesUnclaimed.toFixed(2)} of ${config.minAmount}, ${intervalsSinceSweep} of ${config.maxIntervals} intervals`,
  };
}

export type RetireConfig = {
  /**
   * Net rate per interval under which a position is not worth holding.
   *
   * Zero, not a small positive number. A position earning slightly more than
   * its bleed is still earning, and closing it costs gas and slippage; the
   * question of whether something else would earn MORE is the rebalance and
   * allocation decision, and belongs to those rules rather than this one.
   */
  floorRate: number;
  /** Consecutive observations under the floor before closing. */
  runLength: number;
};

export const DEFAULT_RETIRE: RetireConfig = {
  floorRate: 0,
  runLength: 10,
};

export type RetireVerdict = {
  retire: boolean;
  /** Consecutive observations under the floor, including this one. */
  run: number;
  reason: string;
};

/**
 * Should this position be closed for not earning?
 *
 * `recentRates` is the position's net rate over the last observations, oldest
 * first. Passing the whole series rather than a running counter keeps the rule
 * stateless: the same input always gives the same answer, and a keeper restart
 * cannot half-remember a run.
 */
export function shouldRetire(
  recentRates: number[],
  config: RetireConfig = DEFAULT_RETIRE,
): RetireVerdict {
  let run = 0;
  for (let i = recentRates.length - 1; i >= 0; i--) {
    if (recentRates[i] > config.floorRate) break;
    run++;
  }

  if (recentRates.length < config.runLength) {
    return {
      retire: false,
      run,
      reason: `only ${recentRates.length} observations, needs ${config.runLength}`,
    };
  }
  if (run >= config.runLength) {
    return {
      retire: true,
      run,
      reason: `net rate at or below ${config.floorRate} for ${run} straight observations`,
    };
  }
  return {
    retire: false,
    run,
    reason: run === 0 ? "still earning" : `${run} of ${config.runLength} under the floor`,
  };
}
