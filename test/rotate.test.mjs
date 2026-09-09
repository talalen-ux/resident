/**
 * Rotation: moving capital off a pool that has stopped working.
 *
 * The leak this closes never shows up as a loss. Every position is above its
 * floor, no retire rule trips, and the money sits in the pool that was best
 * when it was deployed rather than the one that is best now.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ROTATION,
  evaluateRotation,
  idleCapital,
  rankRotations,
} from "../src/lib/sim/rotate.ts";
import { scan } from "../src/lib/sim/scanner.ts";

const RANGING = [100, 104, 97, 102, 96, 101, 99, 103, 98, 100, 102, 99];

const pool = (name, volume) => ({
  name, chain: "robinhood", kind: "band",
  volume, volatility: 0.003, liquidity: 120_000, feePips: 3000, prices: RANGING,
});

/** A board with a clear winner and a clear laggard. */
const board = () =>
  scan([pool("MOO/USDG", 400_000), pool("BONER/USDG", 20_000)], null, 10_000, {}).ranked;

const held = (over = {}) => ({
  name: "BONER/USDG", chain: "robinhood", capital: 10_000,
  currentRate: 0.000002, unrealised: 400, ageIntervals: 900, ...over,
});

const COST = { gas: 6, slippageFraction: 0.001 };

test("the board has a winner and a laggard to rotate between", () => {
  const ranked = board();
  const moo = ranked.find((r) => r.pool.name === "MOO/USDG");
  const boner = ranked.find((r) => r.pool.name === "BONER/USDG");
  assert.ok(moo.netRate > boner.netRate, "the fixture must actually differ");
  assert.ok(moo.eligible && boner.eligible);
});

test("capital moves to the pool that is paying now, not the one that was", () => {
  const v = evaluateRotation(held(), board(), new Set(["BONER/USDG"]), COST);
  assert.equal(v.rotate, true);
  assert.equal(v.to.pool.name, "MOO/USDG");
  assert.ok(v.margin >= DEFAULT_ROTATION.requiredMargin);
  assert.match(v.reason, /what this does/);
});

/**
 * The mistake that would make this rule worse than not having it. The
 * unrealised result is already whatever it is; closing writes it down rather
 * than creating it, and counting it as a cost argues for staying in exactly the
 * positions that have stopped paying.
 */
test("an unrealised loss is not a cost of moving", () => {
  const winner = evaluateRotation(held({ unrealised: 900 }), board(), new Set(), COST);
  const loser = evaluateRotation(held({ unrealised: -900 }), board(), new Set(), COST);
  assert.equal(winner.rotate, true);
  assert.equal(loser.rotate, true, "a losing position still moves");
  assert.equal(winner.cost, loser.cost, "and costs the same to move");
  assert.equal(winner.booksProfit, true);
  assert.equal(loser.booksProfit, false);
  assert.ok(!loser.reason.includes("books a profit"));
});

test("a pool the desk is already in is not somewhere to rotate to", () => {
  const both = new Set(["BONER/USDG", "MOO/USDG"]);
  const v = evaluateRotation(held(), board(), both, COST);
  assert.equal(v.rotate, false);
  assert.equal(v.to, null);
  assert.match(v.reason, /nothing on the board pays more/);
});

test("a trending pool is never a rotation target, however well it pays", () => {
  const TRENDING = [100, 92, 84, 77, 70, 64, 58, 52, 47, 42, 38, 34];
  const falling = { ...pool("RUG/USDG", 900_000), prices: TRENDING };
  const ranked = scan([falling, pool("BONER/USDG", 20_000)], null, 10_000, {}).ranked;
  assert.ok(ranked[0].pool.name === "RUG/USDG", "it does top the board");
  const v = evaluateRotation(held(), ranked, new Set(["BONER/USDG"]), COST);
  assert.equal(v.rotate, false, "and it is still not where the money goes");
});

test("a marginal edge does not churn the position", () => {
  const barely = held({ currentRate: board()[0].netRate * 0.999 });
  const v = evaluateRotation(barely, board(), new Set(), COST);
  assert.equal(v.rotate, false);
  assert.match(v.reason, /needs 3x/);
});

test("a young or small position is left alone whatever the maths says", () => {
  assert.equal(evaluateRotation(held({ ageIntervals: 5 }), board(), new Set(), COST).rotate, false);
  assert.equal(evaluateRotation(held({ capital: 200 }), board(), new Set(), COST).rotate, false);
});

test("crossing a chain is charged for, and can be the thing that stops it", () => {
  const local = evaluateRotation(held(), board(), new Set(), COST);
  const across = evaluateRotation(held(), board(), new Set(), { ...COST, bridgeFraction: 0.05 });
  assert.ok(across.cost > local.cost);
  assert.ok(across.margin < local.margin);
});

/* --------------------------------------------------------------- the board */

test("the worst-earning position is the one reported first", () => {
  const positions = [
    held({ name: "A/USDG", currentRate: 0.00004 }),
    held({ name: "BONER/USDG", currentRate: 0.000001 }),
    held({ name: "B/USDG", currentRate: 0.00002 }),
  ];
  const ranked = rankRotations(positions, board(), COST);
  assert.equal(ranked[0].from.name, "BONER/USDG", "the leak is at the bottom of the list");
});

/**
 * Where two rotations are otherwise equal, the one that closes into profit is
 * preferred: a loss has to be absorbed by working capital, which pauses holder
 * accrual until it is earned back.
 */
test("a tie goes to the position that closes into profit", () => {
  const positions = [
    held({ name: "LOSS/USDG", unrealised: -500 }),
    held({ name: "GAIN/USDG", unrealised: 500 }),
  ];
  const ranked = rankRotations(positions, board(), COST).filter((v) => !v.rotate || true);
  const gain = ranked.findIndex((v) => v.from.name === "GAIN/USDG");
  const loss = ranked.findIndex((v) => v.from.name === "LOSS/USDG");
  assert.ok(gain < loss, "same rate, same age: the profitable exit sorts first");
});

/* -------------------------------------------------------------- the metric */

test("lazy capital is measurable even when nothing yet clears the margin", () => {
  const positions = [
    held({ name: "BONER/USDG", capital: 10_000, currentRate: 0.000001 }),
    held({ name: "MOO/USDG", capital: 5_000, currentRate: 0.0004 }),
  ];
  const idle = idleCapital(positions, board(), 0.0001);
  assert.equal(idle.capital, 10_000);
  assert.deepEqual(idle.positions, ["BONER/USDG"]);
  assert.ok(idle.bestRate > 0);
  assert.ok(idle.foregone > 0, "what that capital is giving up, per interval");
});

test("with nothing on the board there is nothing foregone", () => {
  const idle = idleCapital([held()], [], 1);
  assert.equal(idle.bestRate, 0);
  assert.equal(idle.foregone, 0);
});
