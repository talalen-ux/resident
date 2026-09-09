/**
 * The ask ladder: inventory placed above the price, sold into strength.
 *
 * A one-sided position funded with the token alone, its whole range above spot.
 * Price rises through it and each slice sells higher than the last, earning the
 * pool fee on every fill; price falls and nothing fills, nothing is bought, and
 * the desk holds what it already held.
 *
 * WHY THIS CANNOT BE PRICED LIKE A BAND, AND WHAT BREAKS IF IT IS
 *
 * evaluateEntry asks whether fees beat the cost of the price moving, measured
 * against holding CASH. That is the right question for a two-sided band, which
 * is a decision to take inventory the desk did not have.
 *
 * An ask ladder is not that decision. The desk already holds the token — it
 * arrives as protocol fees whether or not anything is placed. So the baseline
 * is HOLDING, and against holding the divergence loss is not a cost at all: if
 * the price halves, an un-placed inventory and a laddered inventory are both
 * worth half. Charging a ladder for bleed rejects a position that cannot lose
 * to its own alternative.
 *
 * The real cost is the opposite one, and a band model has no term for it: a
 * price that runs through the ceiling has sold the whole ladder at ladder
 * prices while the token kept going. That is FOREGONE UPSIDE, it is bounded by
 * how far above spot the ladder was placed, and it is the only reason not to
 * place one as tight as possible.
 *
 * So the three terms are fees, the premium collected for selling above spot,
 * and the upside given up, all measured against doing nothing.
 *
 * THE APPROXIMATION, STATED
 *
 * Fills are computed from the distribution of log-price over the horizon, with
 * liquidity taken as uniform in log space, which is what an evenly spread range
 * is. Time in range is integrated over the horizon rather than read off the
 * terminal distribution, because a path that crosses and comes back earns fees
 * that a terminal snapshot does not see. Both integrals are numeric; a closed
 * form for the second does not exist for a driftless walk with a moving
 * variance and pretending otherwise would be the weaker half of this model.
 */

import { liquidityForBase, liquidityForCapital } from "./band.ts";

export type LadderInputs = {
  /** Quote volume per interval. */
  volume: number;
  /** Pool fee in hundredths of a bip: 3000 = 0.30%. */
  feePips: number;
  /** Quote-denominated liquidity competing where the ladder sits. */
  liquidity: number;
  /** Base tokens held and available to sell. */
  quantity: number;
  /** Spot price in quote per base. */
  price: number;
  /** Where the ladder starts, as a fraction above spot. 0.01 = 1% over. */
  gap: number;
  /** How far it extends above its start, as a fraction. */
  width: number;
  /** Per-interval volatility of log price. */
  volatility: number;
  /** Intervals this placement is judged over. */
  horizon: number;
  /** See BandConfig.captureEfficiency: the naive fee formula is an upper bound. */
  captureEfficiency: number;
};

export type LadderVerdict = {
  /** Expected fraction of the inventory sold over the horizon. */
  filled: number;
  /** Fraction of the horizon the price spends inside the ladder. */
  timeInRange: number;
  /** Average sale price over spot, as a fraction, on the part that sells. */
  averagePremium: number;
  /** Fee income per interval, as a fraction of the inventory's value. */
  feeRate: number;
  /** Premium captured per interval, same units. Always positive. */
  premiumRate: number;
  /** Upside given up per interval when the price runs past the ceiling. */
  foregoneRate: number;
  /**
   * feeRate + premiumRate − foregoneRate.
   *
   * Measured against HOLDING the inventory, not against cash. Positive means
   * placing this ladder beats doing nothing with the same tokens.
   */
  edgeOverHold: number;
  reason: string;
};

/** Standard normal density. */
const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/**
 * Integrate f over the log-return distribution at standard deviation `s`.
 *
 * A midpoint rule over ±5 sigma. Steps rather than a closed form because the
 * integrand changes shape at the ladder's two edges, and because the same
 * routine then serves both the fill and the upside integrals.
 */
function overReturns(s: number, f: (x: number) => number, steps = 401): number {
  if (!(s > 0)) return f(0);
  const lo = -5 * s;
  const hi = 5 * s;
  const dx = (hi - lo) / steps;
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const x = lo + dx * (i + 0.5);
    total += f(x) * phi(x / s) * (dx / s);
  }
  return total;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Price one ask ladder.
 *
 * `gap` and `width` are fractions of spot, so a ladder from 2% to 12% above the
 * price is gap 0.02, width 0.10.
 */
export function evaluateLadder(inputs: LadderInputs): LadderVerdict {
  const { gap, width, volatility, horizon } = inputs;

  if (!(inputs.quantity > 0) || !(inputs.price > 0)) {
    return empty("no inventory to place");
  }
  if (!(width > 0)) return empty("a ladder needs width");
  if (!(volatility > 0)) {
    // Same rule as everywhere else in this desk: an unmeasured volatility is
    // not a calm market. Without it there is no distribution to integrate and
    // the ladder would price as free money.
    throw new Error(
      "volatility is required. Without it a ladder fills at no cost and prices " +
        "as pure premium, which is the most flattering possible error.",
    );
  }

  // Ladder bounds in log space.
  const a = Math.log(1 + gap);
  const b = Math.log((1 + gap) * (1 + width));
  const s = volatility * Math.sqrt(horizon);

  // How much of the ladder the terminal price has crossed. Liquidity is uniform
  // in log space, so the fraction sold is the fraction of [a,b] passed.
  const filled = overReturns(s, (x) => clamp01((x - a) / (b - a)));

  // The average log price at which that happened: everything below the
  // terminal price inside the ladder has sold, so the average is the midpoint
  // of the crossed part.
  const soldWeighted = overReturns(s, (x) => {
    const f = clamp01((x - a) / (b - a));
    if (f <= 0) return 0;
    const top = Math.min(x, b);
    return f * ((a + top) / 2);
  });
  const averageLog = filled > 0 ? soldWeighted / filled : a;
  const averagePremium = Math.exp(averageLog) - 1;

  // Upside given up: on the part that sold, the token ended worth exp(x) and
  // the ladder realised exp(averageLog). Only counted where it is a shortfall,
  // because a price that fell back gives up nothing.
  const foregone = overReturns(s, (x) => {
    const f = clamp01((x - a) / (b - a));
    if (f <= 0) return 0;
    const shortfall = Math.exp(x) - Math.exp(Math.min((a + Math.min(x, b)) / 2, x));
    return f * Math.max(0, shortfall);
  });

  // Time in range, integrated over the horizon rather than read off the end.
  // A path that crosses the ladder and comes back earns fees the terminal
  // distribution cannot see.
  let inRange = 0;
  const slices = 24;
  for (let i = 1; i <= slices; i++) {
    const st = volatility * Math.sqrt((horizon * i) / slices);
    inRange += overReturns(st, (x) => (x >= a && x <= b ? 1 : 0)) / slices;
  }

  // Fees. The ladder competes for flow only where it sits, and only while the
  // price is there.
  //
  // The share cannot come from concentratedShare: that helper models a band
  // CENTRED on the price, and a ladder is not centred on anything — it sits
  // wholly above. Running it through the two-sided formula silently prices a
  // different position, and by a margin that moves with the gap, so it would be
  // wrong differently for every placement.
  const value = inputs.quantity * inputs.price;
  const share = ladderShare(
    inputs.quantity,
    inputs.price * Math.exp(a),
    inputs.price * Math.exp(b),
    inputs.price,
    inputs.liquidity,
  );
  const feeIncome =
    inputs.volume *
    (inputs.feePips / 1_000_000) *
    share *
    inRange *
    inputs.captureEfficiency;

  const feeRate = value > 0 ? feeIncome / value : 0;
  const premiumRate = (filled * averagePremium) / horizon;
  const foregoneRate = foregone / horizon;
  const edgeOverHold = feeRate + premiumRate - foregoneRate;

  return {
    filled,
    timeInRange: inRange,
    averagePremium,
    feeRate,
    premiumRate,
    foregoneRate,
    edgeOverHold,
    reason:
      edgeOverHold > 0
        ? `sells ${(filled * 100).toFixed(0)}% at ${(averagePremium * 100).toFixed(1)}% over spot, ` +
          `fees ${(feeRate * 1e4).toFixed(2)}bps/interval`
        : `gives up ${(foregoneRate * 1e4).toFixed(2)}bps of upside for ` +
          `${((feeRate + premiumRate) * 1e4).toFixed(2)}bps of income`,
  };
}

/**
 * The ladder's share of the flow crossing it.
 *
 * Our L comes from the base-token side, because that is all the ladder holds.
 * The pool's comes from its quote-denominated depth within `referenceWidth` of
 * spot, which is how depth is reported; using it as a proxy for depth up inside
 * the ladder is the same approximation the band model makes, and is the weaker
 * half of both.
 */
export function ladderShare(
  quantity: number,
  lower: number,
  upper: number,
  price: number,
  poolLiquidity: number,
  referenceWidth = 0.05,
): number {
  const ours = liquidityForBase(quantity, lower, upper);
  const theirs = liquidityForCapital(
    poolLiquidity,
    price * (1 - referenceWidth),
    price * (1 + referenceWidth),
    price,
  );
  if (ours + theirs <= 0) return 0;
  return ours / (ours + theirs);
}

function empty(reason: string): LadderVerdict {
  return {
    filled: 0,
    timeInRange: 0,
    averagePremium: 0,
    feeRate: 0,
    premiumRate: 0,
    foregoneRate: 0,
    edgeOverHold: 0,
    reason,
  };
}

export type LadderPlacement = {
  gap: number;
  width: number;
  verdict: LadderVerdict;
};

/**
 * The gap and width worth placing, searched rather than assumed.
 *
 * Tight and close sells almost everything and gives up the most if the token
 * runs; far and wide sells little and keeps the upside. The optimum moves with
 * volatility, which is why it is searched per pool rather than configured once.
 */
export function bestLadder(
  inputs: Omit<LadderInputs, "gap" | "width">,
  gaps = [0.005, 0.01, 0.02, 0.04, 0.08],
  widths = [0.02, 0.05, 0.1, 0.2, 0.4],
): LadderPlacement {
  let best: LadderPlacement | null = null;
  for (const gap of gaps) {
    for (const width of widths) {
      const verdict = evaluateLadder({ ...inputs, gap, width });
      if (!best || verdict.edgeOverHold > best.verdict.edgeOverHold) {
        best = { gap, width, verdict };
      }
    }
  }
  return best!;
}

export type LadderState = {
  /** Where the ladder was placed, in quote per base. */
  lower: number;
  upper: number;
  /** Base tokens still in it. */
  remaining: number;
  /** What it started with. */
  placed: number;
  ageIntervals: number;
};

export type ReplaceConfig = {
  /** Re-place once this fraction of the ladder has sold. */
  soldFraction: number;
  /** Re-place if the price has run this far below the ladder's foot. */
  strayFraction: number;
  /** Never re-place a ladder younger than this. */
  minAgeIntervals: number;
};

export const DEFAULT_REPLACE: ReplaceConfig = {
  soldFraction: 0.9,
  // Deliberately generous. A ladder below the price is a resting sell order:
  // it costs nothing to leave, holds tokens the desk holds anyway, and cannot
  // lose to its own alternative. Chasing the price down with it converts a free
  // option into a decision to sell lower, which is the opposite of the point.
  strayFraction: 0.35,
  minAgeIntervals: 30,
};

export type ReplaceVerdict = { replace: boolean; reason: string };

/**
 * Should a ladder be picked up and put down somewhere else?
 *
 * Two reasons, and neither is "the price fell". Sold through: the ladder is
 * mostly quote now and the inventory that is left should be working higher up.
 * Strayed a long way: the price is so far below that this ladder will not fill
 * this side of a different market, and the tokens are better used elsewhere —
 * which is a rotation decision, not a re-placement, so this only flags it.
 */
export function shouldReplaceLadder(
  state: LadderState,
  price: number,
  config: ReplaceConfig = DEFAULT_REPLACE,
): ReplaceVerdict {
  if (state.ageIntervals < config.minAgeIntervals) {
    return { replace: false, reason: `only ${state.ageIntervals} intervals old` };
  }

  const sold = state.placed > 0 ? 1 - state.remaining / state.placed : 0;
  if (sold >= config.soldFraction) {
    return {
      replace: true,
      reason: `${(sold * 100).toFixed(0)}% sold through; re-place above the new price`,
    };
  }

  if (price > 0 && state.lower > 0) {
    const below = state.lower / price - 1;
    if (below >= config.strayFraction) {
      return {
        replace: true,
        reason: `price is ${(below * 100).toFixed(0)}% under the ladder; it will not fill from here`,
      };
    }
  }

  return {
    replace: false,
    reason:
      sold > 0
        ? `${(sold * 100).toFixed(0)}% sold, still resting`
        : "resting, and costing nothing to rest",
  };
}
