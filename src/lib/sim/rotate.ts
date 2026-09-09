/**
 * Moving capital off a pool that has stopped working and onto one that is.
 *
 * The rules already here each answer a different question and none of them
 * answers this one. shouldRebalance asks whether to re-centre on the SAME pool.
 * shouldRetire asks whether a position has stopped earning at all. bestMove
 * asks whether to cross a chain. What none of them asks is the question an
 * operator asks constantly: this position is fine, and that pool over there is
 * paying three times as much, so why is the money here?
 *
 * A desk without this leaks in a way that never shows up as a loss. Every
 * position is above its floor, nothing trips a retire rule, and the capital
 * sits in the pool that was best when it was deployed rather than the pool that
 * is best now. The board can be perfectly right about which pool is paying most
 * and the money can still be somewhere else.
 *
 * WHAT COUNTS AS A COST, AND WHAT DOES NOT
 *
 * Rotating costs gas twice and slippage twice: unwinding here, entering there.
 * It does NOT cost the position's unrealised profit or loss. That number is
 * already whatever it is — closing writes it down, it does not create it — and
 * counting it as a cost of moving argues for staying in exactly the positions
 * that have stopped paying. Same reasoning as the note in rebalance.ts, and the
 * same mistake if it is got wrong.
 *
 * There is one asymmetry, and it is about accounting rather than economics. A
 * position above its cost basis closes into realised profit; one below closes
 * into a loss the vault has to absorb, which pauses holder accrual until it is
 * earned back. So where two rotations are otherwise equal, the one that books a
 * profit is preferred. This is a tiebreak, never a reason to hold a losing
 * position that should move.
 */

import type { ScanResult } from "./scanner.ts";

export type HeldPosition = {
  /** Pool name, matching the board. */
  name: string;
  chain: string;
  /** Capital at work, in quote units. */
  capital: number;
  /** Net rate per interval this position is earning now, in the board's units. */
  currentRate: number;
  /**
   * Value now less cost basis, in quote units.
   *
   * Positive means closing this books a profit. Not a cost of moving, and not
   * a reason to move: see the note above.
   */
  unrealised: number;
  ageIntervals: number;
};

export type RotationCost = {
  /** Gas to close here and open there, in quote units. */
  gas: number;
  /** Slippage unwinding and re-entering, as a fraction of capital, each way. */
  slippageFraction: number;
  /** Cost of crossing to another chain, as a fraction. Zero to stay put. */
  bridgeFraction?: number;
};

export type RotationConfig = {
  /** Intervals the new position is expected to hold before this is asked again. */
  horizon: number;
  /** Multiple of the cost the uplift must clear before moving. */
  requiredMargin: number;
  /** Do not rotate a position younger than this. */
  minAgeIntervals: number;
  /** Do not rotate less than this, in quote units. */
  minCapital: number;
};

export const DEFAULT_ROTATION: RotationConfig = {
  horizon: 720,
  // Higher than the re-centre margin of 2. Re-centring stays on a pool the desk
  // has already priced; rotating commits to a different pool on an estimate,
  // and an estimate that is wrong costs the round trip and the position.
  requiredMargin: 3,
  minAgeIntervals: 60,
  minCapital: 1_000,
};

export type RotationVerdict = {
  rotate: boolean;
  from: HeldPosition;
  /** Where the capital would go, or null when there is nowhere better. */
  to: ScanResult | null;
  /** Extra earnings over the horizon, before costs. */
  uplift: number;
  cost: number;
  margin: number;
  /** True when closing this position books a profit rather than a loss. */
  booksProfit: boolean;
  reason: string;
};

/**
 * Where this position's capital should be, given everything on the board.
 *
 * `board` is the ranked scan. Pools the desk already holds are excluded, so a
 * rotation is always into somewhere new; moving within one pool is
 * shouldRebalance's job and costs less.
 */
export function evaluateRotation(
  position: HeldPosition,
  board: ScanResult[],
  held: Set<string>,
  cost: RotationCost,
  config: RotationConfig = DEFAULT_ROTATION,
): RotationVerdict {
  const bridge = cost.bridgeFraction ?? 0;
  const totalCost =
    cost.gas * 2 +
    position.capital * cost.slippageFraction * 2 +
    position.capital * bridge;

  const booksProfit = position.unrealised >= 0;

  const candidates = board.filter(
    (r) => r.eligible && r.netRate > position.currentRate && !held.has(r.pool.name),
  );

  const base = {
    from: position,
    to: null as ScanResult | null,
    uplift: 0,
    cost: totalCost,
    margin: 0,
    booksProfit,
  };

  if (position.capital < config.minCapital) {
    return { ...base, rotate: false, reason: `below the ${config.minCapital} floor` };
  }
  if (position.ageIntervals < config.minAgeIntervals) {
    return {
      ...base,
      rotate: false,
      reason: `only ${position.ageIntervals} intervals old`,
    };
  }
  if (!candidates.length) {
    return { ...base, rotate: false, reason: "nothing on the board pays more" };
  }

  const best = candidates.reduce((a, b) => (b.netRate > a.netRate ? b : a));
  const uplift =
    (best.netRate - position.currentRate) * position.capital * config.horizon;
  const margin = totalCost > 0 ? uplift / totalCost : uplift > 0 ? Infinity : 0;

  if (margin < config.requiredMargin) {
    return {
      ...base,
      to: best,
      uplift,
      margin,
      rotate: false,
      reason:
        `${best.pool.name} pays more, but the uplift covers ${margin.toFixed(2)}x ` +
        `the round trip and needs ${config.requiredMargin}x`,
    };
  }

  return {
    ...base,
    to: best,
    uplift,
    margin,
    rotate: true,
    reason:
      `${best.pool.name} earns ${(best.netRate / Math.max(position.currentRate, 1e-12)).toFixed(1)}x ` +
      `what this does; uplift covers ${margin.toFixed(2)}x the round trip` +
      (booksProfit ? ", and closing books a profit" : ""),
  };
}

/**
 * Every position that should move, worst first.
 *
 * Worst first rather than best-uplift first, because the desk can only rotate
 * so much at once and the leak is at the bottom of the list: the position
 * earning least is the one whose capital is doing least. Ties go to the one
 * that closes into profit.
 */
export function rankRotations(
  positions: HeldPosition[],
  board: ScanResult[],
  cost: RotationCost,
  config: RotationConfig = DEFAULT_ROTATION,
): RotationVerdict[] {
  const held = new Set(positions.map((p) => p.name));

  return positions
    .map((p) => evaluateRotation(p, board, held, cost, config))
    .sort((a, b) => {
      if (a.rotate !== b.rotate) return a.rotate ? -1 : 1;
      if (a.from.currentRate !== b.from.currentRate) {
        return a.from.currentRate - b.from.currentRate;
      }
      return Number(b.booksProfit) - Number(a.booksProfit);
    });
}

/**
 * Capital that is doing nothing much, whether or not it is worth moving yet.
 *
 * The number an operator wants on a board: how much is sitting in positions
 * earning under a threshold, and what it would earn at the best rate available.
 * Reported separately from the rotation decision, because the answer "nothing
 * yet clears the margin" is still worth being able to see the size of.
 */
export function idleCapital(
  positions: HeldPosition[],
  board: ScanResult[],
  underRate: number,
): { capital: number; positions: string[]; bestRate: number; foregone: number } {
  const lazy = positions.filter((p) => p.currentRate < underRate);
  const capital = lazy.reduce((total, p) => total + p.capital, 0);
  const eligible = board.filter((r) => r.eligible);
  const bestRate = eligible.length
    ? Math.max(...eligible.map((r) => r.netRate))
    : 0;
  const foregone = lazy.reduce(
    (total, p) => total + Math.max(0, bestRate - p.currentRate) * p.capital,
    0,
  );
  return { capital, positions: lazy.map((p) => p.name), bestRate, foregone };
}
