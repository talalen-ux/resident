/**
 * Getting into a two-sided range from a quote-only treasury.
 *
 * The property that matters is the one the mint checks: after the split, both
 * sides buy the SAME liquidity. A split that is off leaves one side binding
 * and the other sitting in the vault, which is a smaller position than the
 * capital paid for and inventory nobody asked for.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { splitForRange, shortfall } from "../src/lib/keeper/entry.ts";
import { liquidityForAmounts, sqrtPriceAtTick } from "../src/lib/sim/v3.ts";

const Q96 = 2n ** 96n;

/** How far apart the two sides' liquidity is, as a fraction. */
const imbalance = (sqrtP, lower, upper, stock, quote, stockIsToken1) => {
  const a = sqrtPriceAtTick(lower);
  const b = sqrtPriceAtTick(upper);
  const amount0 = stockIsToken1 ? quote : stock;
  const amount1 = stockIsToken1 ? stock : quote;
  const both = liquidityForAmounts(sqrtP, a, b, amount0, amount1);
  const only0 = liquidityForAmounts(sqrtP, a, b, amount0, 2n ** 200n);
  const only1 = liquidityForAmounts(sqrtP, a, b, 2n ** 200n, amount1);
  const spread = only0 > only1 ? only0 - only1 : only1 - only0;
  return { both, drift: Number(spread) / Number(both) };
};

test("a symmetric band splits close to even, but not exactly", () => {
  // Ticks are symmetric in log space; the amounts are not. "Half and half" is
  // the approximation this exists to avoid.
  const split = splitForRange({
    sqrtPriceX96: Q96,
    tickLower: -540,
    tickUpper: 540,
    stockIsToken1: false,
    quoteAmount: 10_000_000_000n,
  });
  assert.ok(split.sell > 0n, "a band on spot needs stock");
  const share = Number(split.sell) / 10_000_000_000;
  assert.ok(share > 0.45 && share < 0.55, `expected near half, got ${share}`);
  assert.equal(split.sell + split.keep, 10_000_000_000n);
});

test("both sides buy the same liquidity, which is the point", () => {
  for (const [lower, upper] of [[-540, 540], [-60, 1200], [-3000, 300], [-12_000, 12_000]]) {
    const quoteAmount = 10_000_000_000n;
    const split = splitForRange({
      sqrtPriceX96: Q96, tickLower: lower, tickUpper: upper,
      stockIsToken1: false, quoteAmount,
    });
    const { drift } = imbalance(Q96, lower, upper, split.stockNeeded, split.keep, false);
    assert.ok(drift < 0.001, `${lower}..${upper} left the sides ${drift} apart`);
  }
});

test("it works the other way round when the stock is token1", () => {
  const quoteAmount = 10_000n * 10n ** 18n;
  const split = splitForRange({
    sqrtPriceX96: Q96, tickLower: -540, tickUpper: 540,
    stockIsToken1: true, quoteAmount,
  });
  const { drift } = imbalance(Q96, -540, 540, split.stockNeeded, split.keep, true);
  assert.ok(drift < 0.001, `sides ${drift} apart`);
});

test("a range entirely above spot is bought outright", () => {
  // Above the price the range holds token0 only. With the stock as token0,
  // every unit of quote has to become stock.
  const split = splitForRange({
    sqrtPriceX96: Q96, tickLower: 600, tickUpper: 1200,
    stockIsToken1: false, quoteAmount: 10_000_000_000n,
  });
  assert.equal(split.keep, 0n);
  assert.equal(split.sell, 10_000_000_000n);
  assert.ok(split.stockNeeded > 0n);
});

test("a range entirely below spot needs no stock at all", () => {
  // The ladder case: rest quote below the price and buy nothing. A split that
  // sold here would pay a spread to acquire a token the position never uses.
  const split = splitForRange({
    sqrtPriceX96: Q96, tickLower: -1200, tickUpper: -600,
    stockIsToken1: false, quoteAmount: 10_000_000_000n,
  });
  assert.equal(split.sell, 0n);
  assert.equal(split.stockNeeded, 0n);
  assert.equal(split.keep, 10_000_000_000n);
});

test("an off-centre band sells the side it is short of", () => {
  // Skewed up: most of the range sits above spot, so most of the capital has
  // to become stock. An even split would leave the quote side binding.
  const up = splitForRange({
    sqrtPriceX96: Q96, tickLower: -60, tickUpper: 3000,
    stockIsToken1: false, quoteAmount: 10_000_000_000n,
  });
  const down = splitForRange({
    sqrtPriceX96: Q96, tickLower: -3000, tickUpper: 60,
    stockIsToken1: false, quoteAmount: 10_000_000_000n,
  });
  assert.ok(up.sell > down.sell, "the upper-skewed band should buy more stock");
  assert.ok(Number(up.sell) / 1e10 > 0.9, "nearly all of it, in fact");
  assert.ok(Number(down.sell) / 1e10 < 0.1);
});

test("a price far outside the range is clamped, not extrapolated", () => {
  // sqrtP below the range: the amounts are taken at the lower edge. Left
  // unclamped the token0 leg would be computed across a span the position does
  // not span, and the split would ask for stock it cannot use.
  const split = splitForRange({
    sqrtPriceX96: Q96 / 4n, tickLower: 600, tickUpper: 1200,
    stockIsToken1: false, quoteAmount: 10_000_000_000n,
  });
  assert.equal(split.keep, 0n);
  assert.ok(split.stockNeeded > 0n);
});

test("nothing to commit means nothing to sell", () => {
  const split = splitForRange({
    sqrtPriceX96: Q96, tickLower: -540, tickUpper: 540,
    stockIsToken1: false, quoteAmount: 0n,
  });
  assert.equal(split.sell, 0n);
  assert.equal(split.stockNeeded, 0n);
});

test("an inverted range is refused rather than sized backwards", () => {
  const split = splitForRange({
    sqrtPriceX96: Q96, tickLower: 540, tickUpper: 540,
    stockIsToken1: false, quoteAmount: 10_000_000_000n,
  });
  assert.equal(split.sell, 0n);
  assert.equal(split.keep, 10_000_000_000n);
});

test("stock already held is not bought again", () => {
  // Fees arrive as the token, so a running desk rarely starts from zero.
  assert.equal(shortfall(1000n, 0n, 0), 1000n);
  assert.equal(shortfall(1000n, 400n, 0), 600n);
  assert.equal(shortfall(1000n, 1000n, 0), 0n);
  assert.equal(shortfall(1000n, 5000n, 0), 0n, "a surplus is not a negative buy");
});

test("the buffer covers re-sizing after the swap moved the price", () => {
  // The mint re-derives its amounts against the post-swap pool. A few raw
  // units short turns a successful entry into a smaller position.
  assert.equal(shortfall(10_000n, 0n, 50), 10_050n);
  assert.equal(shortfall(10_000n, 9_000n, 50), 1_050n);
});
