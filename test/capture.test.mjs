/**
 * Capture: what fraction of a fee estimate a position actually collects.
 *
 * This is the number that decides whether the entry test is honest. Every fee
 * figure the desk produces is an upper bound, and a desk that opens positions
 * at the upper bound opens positions whose true income is below the bleed they
 * are charged. They pass the test because the flattering half of the arithmetic
 * was measured and the sobering half was not.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CAPTURE,
  calibrate,
  captureFor,
  deskWide,
} from "../src/lib/sim/capture.ts";
import { DEFAULT_SCAN, pricePool, scan } from "../src/lib/sim/scanner.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const samples = (pool, n, estimated, realized, spacing = HOUR) =>
  Array.from({ length: n }, (_, i) => ({
    pool, estimated, realized, at: NOW - i * spacing,
  }));

test("enough samples make a pool measured, and the ratio is the ratio", () => {
  const c = calibrate(samples("MOO/USDG", 20, 100, 60), NOW);
  const moo = c.get("MOO/USDG");
  assert.equal(moo.measured, true);
  assert.ok(Math.abs(moo.efficiency - 0.6) < 1e-9);
});

test("too few samples is unmeasured, and does not report a ratio it computed", () => {
  const c = calibrate(samples("THIN/USDG", 3, 100, 60), NOW);
  const thin = c.get("THIN/USDG");
  assert.equal(thin.measured, false);
  assert.equal(thin.efficiency, DEFAULT_CAPTURE.unmeasured);
});

/**
 * The failure a mean over ratios would have. One interval where the model
 * predicted almost nothing and a few cents arrived produces a ratio in the
 * hundreds, and a mean lets that one interval set the number for the pool.
 */
test("one tiny estimate cannot set the number for a pool", () => {
  const normal = samples("MOO/USDG", 30, 100, 60);
  const freak = { pool: "MOO/USDG", estimated: 0.0001, realized: 5, at: NOW };
  const c = calibrate([...normal, freak], NOW);
  assert.ok(
    Math.abs(c.get("MOO/USDG").efficiency - 0.6) < 0.02,
    `a sum over sums barely moves: ${c.get("MOO/USDG").efficiency}`,
  );
});

test("a capture far above one is an input error, and is clamped", () => {
  const c = calibrate(samples("ODD/USDG", 30, 10, 400), NOW);
  assert.equal(c.get("ODD/USDG").efficiency, DEFAULT_CAPTURE.ceiling);
});

test("an interval the model declined to predict is dropped, not counted as a miss", () => {
  const withZeros = [
    ...samples("MOO/USDG", 20, 100, 60),
    ...samples("MOO/USDG", 20, 0, 0, HOUR).map((s) => ({ ...s, at: s.at - 1 })),
  ];
  const c = calibrate(withZeros, NOW);
  assert.ok(Math.abs(c.get("MOO/USDG").efficiency - 0.6) < 1e-9);
});

test("old samples count less, so a pool that changed is not held to last week", () => {
  const recent = samples("MOO/USDG", 20, 100, 20, HOUR);
  const ancient = samples("MOO/USDG", 20, 100, 90, HOUR).map((s) => ({
    ...s, at: s.at - 14 * 24 * HOUR,
  }));
  const c = calibrate([...recent, ...ancient], NOW);
  assert.ok(
    c.get("MOO/USDG").efficiency < 0.3,
    `recent evidence dominates: ${c.get("MOO/USDG").efficiency}`,
  );
});

/* ------------------------------------------------------------ which number */

test("a pool's own measurement is used before the desk's", () => {
  const c = calibrate(
    [...samples("MOO/USDG", 20, 100, 30), ...samples("ZZZ/USDG", 20, 100, 90)],
    NOW,
  );
  const moo = captureFor("MOO/USDG", c);
  assert.equal(moo.source, "pool");
  assert.ok(Math.abs(moo.efficiency - 0.3) < 1e-9);
});

/**
 * A desk capturing 60% of its estimates everywhere is better evidence about a
 * pool it has never traded than a placeholder is, and it is available from the
 * first day.
 */
test("a pool with no history of its own falls back to the desk, not the placeholder", () => {
  const c = calibrate(samples("MOO/USDG", 40, 100, 60), NOW);
  const fresh = captureFor("NEW/USDG", c);
  assert.equal(fresh.source, "desk");
  assert.ok(Math.abs(fresh.efficiency - 0.6) < 1e-9);
});

test("with nothing measured anywhere the assumption is used, and says so", () => {
  const fresh = captureFor("NEW/USDG", new Map());
  assert.equal(fresh.source, "assumed");
  assert.equal(fresh.efficiency, DEFAULT_CAPTURE.unmeasured);
});

test("the desk figure needs its own minimum before it is evidence", () => {
  assert.equal(deskWide(calibrate(samples("A/USDG", 2, 100, 60), NOW)), null);
});

/* ------------------------------------------------------------ on the board */

const RANGING = [100, 104, 97, 102, 96, 101, 99, 103, 98, 100, 102, 99];
const pool = (name) => ({
  name, chain: "robinhood", kind: "band",
  volume: 60_000, volatility: 0.003, liquidity: 120_000, feePips: 3000,
  prices: RANGING,
});

/** The point of all of it: a measured pool is priced at what it pays. */
test("measured capture changes what a pool is worth, and the result says so", () => {
  const optimistic = pricePool(pool("MOO/USDG"));
  assert.equal(optimistic.capture.source, "assumed");

  const c = calibrate(samples("MOO/USDG", 40, 100, 25), NOW);
  const measured = pricePool(pool("MOO/USDG"), DEFAULT_SCAN, c);
  assert.equal(measured.capture.source, "pool");
  assert.ok(Math.abs(measured.capture.efficiency - 0.25) < 1e-9);
  assert.ok(
    measured.netRate < optimistic.netRate,
    "a pool that pays a quarter of its estimate is worth less",
  );
});

/**
 * The whole reason this exists. The bleed is unchanged and real; only the
 * income was optimistic, so a pool that clears the test at the ceiling can be a
 * losing position at what it actually pays.
 */
test("a pool that passes at the ceiling can fail at what it really pays", () => {
  const thin = { ...pool("THIN/USDG"), volume: 6_000 };
  const atCeiling = pricePool(thin, { ...DEFAULT_SCAN, captureEfficiency: 1, capture: { ...DEFAULT_CAPTURE, unmeasured: 1 } });
  const measured = pricePool(thin, DEFAULT_SCAN, calibrate(samples("THIN/USDG", 40, 100, 15), NOW));

  assert.ok(atCeiling.netRate > measured.netRate);
  assert.equal(atCeiling.capture.efficiency, 1);
  assert.ok(Math.abs(measured.capture.efficiency - 0.15) < 1e-9);
});

test("the board prices every pool at its own measurement in one pass", () => {
  const c = calibrate(
    [...samples("MOO/USDG", 40, 100, 90), ...samples("BONER/USDG", 40, 100, 10)],
    NOW,
  );
  const { ranked } = scan([pool("MOO/USDG"), pool("BONER/USDG")], null, 10_000, {}, DEFAULT_SCAN, c);
  const moo = ranked.find((r) => r.pool.name === "MOO/USDG");
  const boner = ranked.find((r) => r.pool.name === "BONER/USDG");
  assert.ok(Math.abs(moo.capture.efficiency - 0.9) < 1e-9);
  assert.ok(Math.abs(boner.capture.efficiency - 0.1) < 1e-9);
  assert.ok(moo.netRate > boner.netRate, "identical pools, ranked by what they pay");
});
