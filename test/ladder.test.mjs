/**
 * The ask ladder.
 *
 * The assertions that matter are about the BASELINE. A band is judged against
 * holding cash; a ladder is judged against holding the tokens, which the desk
 * holds anyway because they arrive as protocol fees. Judge a ladder against
 * cash and it looks like a leveraged long and is always rejected; forget the
 * foregone upside and it looks like free money and is always accepted.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REPLACE,
  bestLadder,
  evaluateLadder,
  shouldReplaceLadder,
} from "../src/lib/sim/ladder.ts";
import { ladderTicks, sizeMint } from "../src/lib/keeper/executor-v4.ts";
import { evaluateEntry } from "../src/lib/sim/strategy.ts";
import { buildPool } from "../src/lib/sim/pools.ts";

const base = (over = {}) => ({
  volume: 50_000, feePips: 10_000, liquidity: 200_000,
  quantity: 1_000_000, price: 0.003,
  volatility: 0.01, horizon: 240, captureEfficiency: 1,
  gap: 0.02, width: 0.1, ...over,
});

/* ------------------------------------------------------------ the baseline */

/**
 * The whole reason this is a separate model. A pool where a two-sided band
 * loses money can still be the right place to rest inventory, because the
 * ladder is judged against holding the tokens rather than against cash and
 * cannot lose to its own alternative through divergence.
 */
test("a ladder is not charged the bleed that rejects a band", () => {
  // A narrow window, and a real one. The ladder's usable range of volatility
  // sits just above the band's, because it pays no divergence loss against its
  // own alternative and only gives up the part of the move it sold into.
  const moving = 0.025;

  const band = evaluateEntry({
    volume: 50_000, liquidity: 200_000, feePips: 10_000,
    volatility: moving, deployed: 3_000, captureEfficiency: 1,
  });
  assert.equal(band.enter, false, "a band here is a losing position");
  assert.ok(band.netRate < 0);

  const ladder = bestLadder(base({ volatility: moving }));
  assert.ok(
    ladder.verdict.edgeOverHold > 0,
    `and the same pool is still worth resting inventory in (${ladder.verdict.edgeOverHold})`,
  );
});

/**
 * The result that decides when NOT to ladder, and the one a fee-ranked view
 * would never surface.
 *
 * On a token that actually runs, a ladder sells the whole inventory into the
 * first leg and watches the rest from the sidelines. The upside given up dwarfs
 * the fees, and the model says so rather than reporting a large fee number. So
 * a runner is the one place to leave inventory alone, or hold it two-sided
 * where it is not being sold at all.
 */
test("on a runner the ladder gives up more than it earns, and says so", () => {
  const runner = evaluateLadder(base({ volatility: 0.05 }));
  assert.ok(runner.feeRate > 0, "the fees are real");
  assert.ok(
    runner.foregoneRate > runner.feeRate + runner.premiumRate,
    "and they are dwarfed by the move that was sold into",
  );
  assert.ok(runner.edgeOverHold < 0, "so this is worse than simply holding");
  assert.match(runner.reason, /gives up/);
});

test("volatility is required, because without it a ladder prices as free money", () => {
  assert.throws(() => evaluateLadder(base({ volatility: 0 })), /volatility is required/);
});

test("nothing to sell is not a position", () => {
  assert.equal(evaluateLadder(base({ quantity: 0 })).edgeOverHold, 0);
  assert.equal(evaluateLadder(base({ width: 0 })).reason, "a ladder needs width");
});

/* --------------------------------------------------------------- the trade */

test("closer and tighter sells more of the inventory", () => {
  const near = evaluateLadder(base({ gap: 0.005, width: 0.02 }));
  const far = evaluateLadder(base({ gap: 0.08, width: 0.4 }));
  assert.ok(near.filled > far.filled, `${near.filled} vs ${far.filled}`);
});

test("further out sells less, at a better price", () => {
  const near = evaluateLadder(base({ gap: 0.005, width: 0.02 }));
  const far = evaluateLadder(base({ gap: 0.08, width: 0.4 }));
  assert.ok(far.averagePremium > near.averagePremium);
  assert.ok(near.averagePremium > 0, "a ladder never sells below spot");
});

/**
 * The term a band model has no name for, and the only reason not to place a
 * ladder as tight as it will go.
 */
test("selling into a run gives up upside, and the tight ladder gives up most", () => {
  const near = evaluateLadder(base({ gap: 0.005, width: 0.02 }));
  const far = evaluateLadder(base({ gap: 0.08, width: 0.4 }));
  assert.ok(near.foregoneRate > far.foregoneRate);
  assert.ok(far.foregoneRate >= 0);
});

test("the premium roughly pays for the upside given up, and fees are the edge", () => {
  const v = evaluateLadder(base());
  const carry = v.premiumRate - v.foregoneRate;
  assert.ok(Math.abs(carry) < v.feeRate, "so the fee is what makes it worth doing");
  assert.ok(v.feeRate > 0);
  assert.ok(Math.abs(v.edgeOverHold - (v.feeRate + carry)) < 1e-12);
});

test("a dead pool pays no fee, and the ladder is then close to a wash", () => {
  const quiet = evaluateLadder(base({ volume: 0 }));
  assert.equal(quiet.feeRate, 0);
  assert.ok(Math.abs(quiet.edgeOverHold) < 0.001, `${quiet.edgeOverHold}`);
});

test("time in range counts the crossings, not just where the price ended", () => {
  const v = evaluateLadder(base());
  assert.ok(v.timeInRange > 0 && v.timeInRange < 1);
});

/* -------------------------------------------------------------- the search */

test("the placement is searched, and the answer moves with volatility", () => {
  const calm = bestLadder(base({ volatility: 0.002 }));
  const wild = bestLadder(base({ volatility: 0.05 }));

  assert.ok(calm.verdict.edgeOverHold > 0, "a calm pool is worth laddering");
  assert.ok(calm.gap <= 0.01, "and worth laddering close to the price");

  // The search returns the least-bad placement rather than refusing; the caller
  // reads the sign. On a runner even the best placement is worse than holding.
  assert.ok(wild.gap > calm.gap, "a volatile pool is laddered further out");
  assert.ok(wild.verdict.edgeOverHold < 0, "and is still not worth laddering");
});

test("the search never returns worse than any point it searched", () => {
  const best = bestLadder(base());
  for (const gap of [0.005, 0.02, 0.08]) {
    for (const width of [0.02, 0.1, 0.4]) {
      const v = evaluateLadder(base({ gap, width }));
      assert.ok(best.verdict.edgeOverHold >= v.edgeOverHold - 1e-12);
    }
  }
});

/* ----------------------------------------------------------- re-placement */

const state = (over = {}) => ({
  lower: 0.0031, upper: 0.0035, remaining: 900_000, placed: 1_000_000,
  ageIntervals: 200, ...over,
});

test("a ladder sold through is picked up and put down higher", () => {
  const v = shouldReplaceLadder(state({ remaining: 50_000 }), 0.0036);
  assert.equal(v.replace, true);
  assert.match(v.reason, /sold through/);
});

/**
 * The judgement call this rule exists to encode. A ladder under the price is a
 * resting sell order on tokens the desk holds anyway: it costs nothing to
 * leave, and chasing the price down with it converts a free option into a
 * decision to sell lower.
 */
test("a price below the ladder is not a reason to move it", () => {
  const partly = shouldReplaceLadder(state(), 0.0028);
  assert.equal(partly.replace, false);
  assert.match(partly.reason, /resting/);

  const untouched = shouldReplaceLadder(state({ remaining: 1_000_000 }), 0.0028);
  assert.equal(untouched.replace, false);
  assert.match(untouched.reason, /costing nothing to rest/);
});

test("but a price that has run a long way under it will not fill from there", () => {
  const v = shouldReplaceLadder(state(), 0.0019);
  assert.equal(v.replace, true);
  assert.match(v.reason, /under the ladder/);
  assert.ok(DEFAULT_REPLACE.strayFraction > 0.2, "and the threshold is generous");
});

test("a fresh ladder is left alone whatever it looks like", () => {
  assert.equal(
    shouldReplaceLadder(state({ ageIntervals: 3, remaining: 0 }), 0.004).replace,
    false,
  );
});

/* ------------------------------------------------------------- on the chain */

const pool = () =>
  buildPool({
    price: 5, liquidity: 20_000n * 10n ** 12n, fee: 3000,
    token0: { symbol: "AMC", decimals: 18 },
    token1: { symbol: "USDG", decimals: 6 },
  });

/**
 * The failure that would make a ladder buy the thing it exists to sell. A range
 * straddling spot is a two-sided band and takes quote as well.
 */
test("the range never straddles the price, even when asked to sit on it", () => {
  const p = pool();
  for (const gap of [0.0000001, 0.001, 0.01, 0.08]) {
    const t = ladderTicks(p, gap, 0.05);
    assert.ok(t.tickLower > p.tick, `gap ${gap}: lower ${t.tickLower} vs ${p.tick}`);
    assert.ok(t.tickUpper > t.tickLower);
    assert.equal(Math.abs(t.tickLower % p.tickSpacing), 0);
  }
});

test("a ladder is funded with the token alone and takes no quote", () => {
  const p = pool();
  const t = ladderTicks(p, 0.01, 0.05);
  const sized = sizeMint({
    state: p, ...t,
    quoteAmount: 0n,
    balance0: 1_000n * 10n ** 18n,
    balance1: 0n,
  });
  assert.ok(sized.liquidity > 0n, "with no quote at all it still places");
  assert.equal(sized.amount1, 0n, "and asks for none");
  assert.ok(sized.amount0 > 0n);
});

test("a wider ladder reaches further up the book", () => {
  const p = pool();
  const tight = ladderTicks(p, 0.01, 0.02);
  const wide = ladderTicks(p, 0.01, 0.4);
  assert.ok(wide.tickUpper > tight.tickUpper);
});
