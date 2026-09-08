/**
 * Band value algebra, checked against closed form and against the identities
 * any correct implementation must satisfy.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  breakevenMove,
  divergenceLoss,
  inRange,
  liquidityForCapital,
  openBand,
  positionAmounts,
  positionValue,
} from "../src/lib/sim/band.ts";

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test("a freshly opened band is worth exactly the capital put in", () => {
  for (const price of [0.0008, 0.05, 5, 240]) {
    for (const w of [0.02, 0.05, 0.2, 0.5]) {
      const band = openBand(price, w, 10_000);
      close(positionValue(band.liquidity, band.lower, band.upper, price), 10_000, 1e-6, "open value");
    }
  }
});

test("a two-sided band opens roughly half in each token", () => {
  const price = 5;
  const band = openBand(price, 0.05, 10_000);
  const { amount0, amount1 } = positionAmounts(band.liquidity, band.lower, band.upper, price);
  const value0 = amount0 * price;
  // A ±5% band is close to balanced; exact symmetry is in sqrt space, not price.
  close(value0 / 10_000, 0.5, 0.02, "token0 share of a centred band");
  close(amount1 / 10_000, 0.5, 0.02, "token1 share of a centred band");
});

test("amounts match the closed form L·(1/√p − 1/√pb) and L·(√p − √pa)", () => {
  const L = 12_345;
  const [pa, pb, p] = [4, 9, 6];
  const { amount0, amount1 } = positionAmounts(L, pa, pb, p);
  close(amount0, L * (1 / Math.sqrt(p) - 1 / Math.sqrt(pb)), 1e-9, "amount0");
  close(amount1, L * (Math.sqrt(p) - Math.sqrt(pa)), 1e-9, "amount1");
});

test("outside the range the position is entirely one token", () => {
  const band = openBand(5, 0.1, 10_000);

  const below = positionAmounts(band.liquidity, band.lower, band.upper, band.lower * 0.5);
  assert.equal(below.amount1, 0, "below the range it is all token0");
  assert.ok(below.amount0 > 0);

  const above = positionAmounts(band.liquidity, band.lower, band.upper, band.upper * 2);
  assert.equal(above.amount0, 0, "above the range it is all token1");
  assert.ok(above.amount1 > 0);
});

test("divergence loss is zero at the opening price and negative either side", () => {
  const band = openBand(5, 0.1, 10_000);
  close(divergenceLoss(band, 5), 0, 1e-9, "no move, no loss");

  for (const p of [4.6, 4.9, 5.1, 5.5, 8]) {
    assert.ok(divergenceLoss(band, p) < 0, `moving to ${p} must cost something`);
  }
});

test("loss grows with the size of the move and stops growing past the bounds", () => {
  const band = openBand(5, 0.1, 10_000);
  const at = (p) => -divergenceLoss(band, p);

  assert.ok(at(5.5) > at(5.2), "a bigger move inside the range costs more");
  assert.ok(at(5.2) > at(5.05));

  // Once fully converted the position stops tracking, so loss vs holding keeps
  // growing — but the position's own value is pinned.
  const atBound = positionValue(band.liquidity, band.lower, band.upper, band.upper);
  const beyond = positionValue(band.liquidity, band.lower, band.upper, band.upper * 3);
  close(beyond, atBound, 1e-6, "value is pinned above the upper bound");
});

test("a tighter band bleeds more for the same move", () => {
  const move = 1.08;
  const tight = openBand(5, 0.05, 10_000);
  const wide = openBand(5, 0.5, 10_000);

  const tightLoss = -divergenceLoss(tight, 5 * move);
  const wideLoss = -divergenceLoss(wide, 5 * move);

  assert.ok(
    tightLoss > wideLoss,
    `concentration cuts both ways: ${(tightLoss * 100).toFixed(2)}% vs ${(wideLoss * 100).toFixed(2)}%`,
  );
});

test("the v2 approximation understates a tight band, which is why it is not used", () => {
  // v2 impermanent loss for a price ratio k: 2√k/(1+k) − 1.
  const k = 1.2;
  const v2 = 2 * Math.sqrt(k) / (1 + k) - 1;
  const tight = -divergenceLoss(openBand(5, 0.05, 10_000), 5 * k);
  assert.ok(
    tight > -v2,
    `a ±5% band loses more than v2 says (${(tight * 100).toFixed(2)}% vs ${(-v2 * 100).toFixed(2)}%)`,
  );
});

test("liquidity scales linearly with capital", () => {
  const a = liquidityForCapital(10_000, 4.5, 5.5, 5);
  const b = liquidityForCapital(20_000, 4.5, 5.5, 5);
  close(b / a, 2, 1e-9, "twice the capital, twice the liquidity");
});

test("inRange tracks the bounds", () => {
  const band = openBand(5, 0.1, 10_000);
  assert.equal(inRange(band, 5), true);
  assert.equal(inRange(band, 4.5), true);
  assert.equal(inRange(band, 5.5), true);
  assert.equal(inRange(band, 4.49), false);
  assert.equal(inRange(band, 5.51), false);
});

test("breakeven is the move at which fees stop covering the bleed", () => {
  const band = openBand(5, 0.1, 10_000);
  const fees = 100; // 1% of capital

  const { up, down } = breakevenMove(band, fees);
  assert.ok(up !== null && down !== null, "1% of fees should not cover every move");

  // At the breakeven move the loss equals the fee income, by construction.
  close(-divergenceLoss(band, 5 * (1 + up)) * 10_000, fees, 1, "upside breakeven");
  close(-divergenceLoss(band, 5 * (1 - down)) * 10_000, fees, 1, "downside breakeven");
});

test("enough fee income covers any move considered", () => {
  const band = openBand(5, 0.1, 10_000);
  const { up, down } = breakevenMove(band, 10_000);
  assert.equal(up, null);
  assert.equal(down, null);
});
