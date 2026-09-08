/**
 * Where the capital should be, across chains.
 *
 * The naive version of this — "Solana is paying more, bridge" — loses money,
 * because it prices the destination and ignores everything the move costs:
 *
 *   1. The bridge takes a fee, twice. You pay to go and you pay to come back,
 *      and the return leg is not optional: capital parked on the far chain is
 *      capital the desk cannot redeploy at home.
 *
 *   2. Bridging takes time, and in that time the capital earns NOTHING. A move
 *      that takes ten minutes each way costs twenty minutes of the rate you
 *      were already earning, before it earns anything new.
 *
 *   3. The edge has to still be there when you arrive. A pool paying more right
 *      now is not a pool paying more in ten minutes, and thin-market edges decay
 *      fastest — exactly the pools worth crossing for.
 *
 * So the test is not "is the remote rate higher". It is whether the edge, held
 * for as long as edges like this actually last, pays for the whole round trip
 * with enough margin left that noise cannot trigger the move on its own.
 */

export type Venue = {
  name: string;
  chain: string;
  /** Net rate per interval — fees less bleed. Comparable across venues. */
  netRate: number;
};

export type BridgeCost = {
  /** Proportional fee for one leg, e.g. 0.0025 for 25bps. */
  feeFraction: number;
  /** Fixed cost of one leg in quote units: gas both sides, relayer, slippage. */
  fixedCost: number;
  /** Intervals in transit for one leg. Capital earns nothing while in flight. */
  latencyIntervals: number;
};

export type AllocationConfig = {
  /**
   * How long an edge is assumed to survive, in intervals.
   *
   * This is the number the decision is most sensitive to and the one nobody
   * can know. It is deliberately short: assuming an edge lasts a day makes
   * almost any move look profitable, and thin-market edges are the ones that
   * decay fastest.
   */
  edgeHalfLife: number;
  /**
   * Margin the round trip must clear before moving, as a multiple of its cost.
   *
   * At 1.0 the desk moves on a break-even estimate built from an assumed
   * half-life and an inferred rate. 1.5 means the move has to be worth half as
   * much again as it costs, which is what keeps estimate noise from churning
   * capital across chains.
   */
  requiredMargin: number;
  /** Do not move less than this, whatever the maths says. */
  minCapital: number;
};

export const DEFAULT_ALLOCATION: AllocationConfig = {
  edgeHalfLife: 720, // twelve hours of minute intervals
  requiredMargin: 1.5,
  minCapital: 2_500,
};

export type AllocationVerdict = {
  move: boolean;
  from: Venue;
  to: Venue;
  capital: number;
  /** Extra earnings over the assumed holding period, before costs. */
  grossGain: number;
  /** Bridge fees, both legs, plus fixed costs. */
  bridgeCost: number;
  /** What the capital gives up while it is in transit, both legs. */
  idleCost: number;
  netGain: number;
  /** netGain divided by total cost. Must clear requiredMargin to move. */
  margin: number;
  reason: string;
};

/**
 * Should capital move from where it is to a better venue?
 *
 * Costs are charged against the CURRENT venue's rate, because that is what the
 * capital gives up by leaving — the alternative to moving is not zero, it is
 * carrying on earning where it already is.
 */
export function evaluateMove(
  from: Venue,
  to: Venue,
  capital: number,
  bridge: BridgeCost,
  config: AllocationConfig = DEFAULT_ALLOCATION,
): AllocationVerdict {
  const edge = to.netRate - from.netRate;

  // Both legs: out now, and back when the position closes.
  const bridgeCost = capital * bridge.feeFraction * 2 + bridge.fixedCost * 2;
  const idleCost = capital * from.netRate * bridge.latencyIntervals * 2;

  const grossGain = capital * edge * config.edgeHalfLife;
  const totalCost = bridgeCost + idleCost;
  const netGain = grossGain - totalCost;
  const margin = totalCost > 0 ? grossGain / totalCost : grossGain > 0 ? Infinity : 0;

  let reason: string;
  let move = false;

  if (capital < config.minCapital) {
    reason = `below the ${config.minCapital} floor`;
  } else if (edge <= 0) {
    reason = `${to.name} does not pay more than ${from.name}`;
  } else if (margin < config.requiredMargin) {
    reason = `edge covers ${margin.toFixed(2)}x the round trip, needs ${config.requiredMargin}x`;
  } else {
    move = true;
    reason = `edge covers ${margin.toFixed(2)}x the round trip over ${config.edgeHalfLife} intervals`;
  }

  return { move, from, to, capital, grossGain, bridgeCost, idleCost, netGain, margin, reason };
}

/**
 * The best move available, or none.
 *
 * Ties go to staying put: the incumbent venue is returned unchanged rather than
 * moved for a rate that only looks better because two estimates disagree.
 */
export function bestMove(
  current: Venue,
  candidates: Venue[],
  capital: number,
  bridges: Record<string, BridgeCost>,
  config: AllocationConfig = DEFAULT_ALLOCATION,
): AllocationVerdict | null {
  let best: AllocationVerdict | null = null;

  for (const candidate of candidates) {
    if (candidate.name === current.name) continue;
    // Same chain needs no bridge; a local switch is free of transit entirely.
    const bridge =
      candidate.chain === current.chain
        ? { feeFraction: 0, fixedCost: 0, latencyIntervals: 0 }
        : bridges[candidate.chain];
    if (!bridge) continue;

    const verdict = evaluateMove(current, candidate, capital, bridge, config);
    if (verdict.move && (!best || verdict.netGain > best.netGain)) best = verdict;
  }

  return best;
}
