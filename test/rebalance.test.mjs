import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REBALANCE,
  rangingScore,
  shouldRebalance,
} from "../src/lib/sim/rebalance.ts";

const COST = { gas: 3, slippageFraction: 0.001 }; // $3 + 10bps
const POSITION = {
  name: "CATE/SOL",
  capital: 10_000,
  currentRate: 0.00002,
  feesUnclaimed: 40,
  ageIntervals: 600,
};

/**
 * The lesson this exists for: a position that is still up but has stopped
 * earning should be re-centred, because the comparison is against what a fresh
 * position would earn here — not against zero, and not against its own P&L.
 */
test("a position earning half a fresh one is re-centred", () => {
  const v = shouldRebalance(POSITION, 0.00006, COST);
  assert.equal(v.rebalance, true, v.reason);
  assert.ok(v.decay > 0.6, `decay ${v.decay}`);
});

test("a position still earning its full rate is left alone", () => {
  const v = shouldRebalance(POSITION, 0.00002, COST);
  assert.equal(v.rebalance, false);
  assert.match(v.reason, /would not earn more/);
});

test("a marginal uplift does not pay for the move", () => {
  // Barely better, over a short horizon: gas eats it.
  const v = shouldRebalance(POSITION, 0.0000201, COST, {
    ...DEFAULT_REBALANCE,
    horizon: 60,
  });
  assert.equal(v.rebalance, false);
  assert.match(v.reason, /covers/);
});

test("a fresh position is not churned on noise", () => {
  const v = shouldRebalance({ ...POSITION, ageIntervals: 5 }, 0.0009, COST);
  assert.equal(v.rebalance, false);
  assert.match(v.reason, /intervals old/);
});

/**
 * The expensive mistake this model refuses to make. The unrealised loss on a
 * drifted position is already taken — closing writes it down, it does not
 * create it. Only gas and rebalancing slippage are costs of moving, so the
 * decision cannot depend on how far underwater the position is.
 */
test("the decision ignores how far the position has drifted in value", () => {
  const winner = shouldRebalance(POSITION, 0.00006, COST);
  // Same pool, same rates, but this one is deep underwater on principal.
  const loser = shouldRebalance(
    { ...POSITION, feesUnclaimed: 0 },
    0.00006,
    COST,
  );
  assert.equal(winner.rebalance, loser.rebalance);
  assert.equal(winner.cost, loser.cost);
});

test("cost is gas plus slippage on the capital, and nothing else", () => {
  const v = shouldRebalance(POSITION, 0.00006, COST);
  assert.ok(Math.abs(v.cost - (3 + 10_000 * 0.001)) < 1e-9, `cost ${v.cost}`);
});

// --- Ranging -----------------------------------------------------------------

const noise = (n, base, amplitude, seed = 1) => {
  let s = seed;
  return Array.from({ length: n }, (_, i) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return base * (1 + ((s / 2147483648) - 0.5) * amplitude * 2) * (1 + Math.sin(i / 7) * 0.02);
  });
};

test("a coin that has held a band for months reads as ranging", () => {
  const { ranging, containment, drift } = rangingScore(noise(500, 0.02, 0.15));
  assert.equal(ranging, true, `containment ${containment} drift ${drift}`);
  assert.ok(containment > 0.9);
});

test("a coin that only goes one way does not", () => {
  const trend = Array.from({ length: 500 }, (_, i) => 0.01 * (1 + i / 100));
  const { ranging, drift } = rangingScore(trend);
  assert.equal(ranging, false);
  assert.ok(drift > 0.4, `drift ${drift}`);
});

test("a rug reads as not ranging", () => {
  const rug = [
    ...Array.from({ length: 200 }, () => 0.05),
    ...Array.from({ length: 300 }, () => 0.001),
  ];
  assert.equal(rangingScore(rug).ranging, false);
});

test("too little history is not a pass", () => {
  // Absence of evidence must not read as evidence of stability.
  assert.equal(rangingScore([1, 1, 1]).ranging, false);
  assert.equal(rangingScore([]).ranging, false);
});
