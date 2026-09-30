/**
 * Caching what the chain said, not what a token set made of it.
 *
 * Discovery is thousands of chunked eth_getLogs calls; the token filter is
 * free. When the two were one step the cache held only what that day's
 * registry allowed, so allowing a new token replayed the whole chain to
 * rediscover pools the scan had already seen and thrown away — a 25-minute
 * penalty for adding a token, which is a reason not to add one.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { watchable } from "../src/lib/desk/rpc-pools-source.ts";
import { TOKENS, STOCK_TOKENS } from "../src/lib/chain.ts";

const AAPL = STOCK_TOKENS.AAPL.address.toLowerCase();
const USDG = TOKENS.usdg.toLowerCase();
const STRANGER = "0x1111111111111111111111111111111111111111";

/**
 * Uniswap orders a pool's currencies by address, and poolId enforces it — so
 * a fixture that does not sort is testing a key no chain would produce.
 */
const pool = (a, b) => {
  const [currency0, currency1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return {
    key: { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: `0x${"0".repeat(40)}` },
    block: 1,
  };
};

test("a canonical pair is watchable with no extra tokens", () => {
  const found = watchable([pool(AAPL, USDG)]);
  assert.equal(found.length, 1);
  assert.ok([found[0].token0.symbol, found[0].token1.symbol].includes("USDG"));
});

test("an unknown token is filtered out, and stays in the cache", () => {
  // The filter's job is to say no. The cache's job is to remember anyway, so
  // that saying yes later costs nothing.
  const raw = [pool(AAPL, USDG), pool(STRANGER, USDG)];
  assert.equal(watchable(raw).length, 1);
  assert.equal(raw.length, 2, "the raw list is not mutated by filtering it");
});

test("allowing a token makes its pool watchable with no rescan", () => {
  // The whole point. Same raw input, different registry, more pools.
  const raw = [pool(AAPL, USDG), pool(STRANGER, USDG)];
  const extra = new Map([[STRANGER, { symbol: "CASHCAT", decimals: 18, address: STRANGER }]]);

  assert.equal(watchable(raw).length, 1);
  assert.equal(watchable(raw, extra).length, 2, "no chain access needed to widen the board");
});

test("the extra tier cannot shadow a canonical token", () => {
  // A variable that could redefine AAPL's decimals would mis-scale every
  // figure for it, and look like a market move rather than a typo.
  const extra = new Map([[AAPL, { symbol: "NOTAAPL", decimals: 6, address: AAPL }]]);
  const found = watchable([pool(AAPL, USDG)], extra);
  const aapl = [found[0].token0, found[0].token1].find((t) => t.address === AAPL);
  assert.equal(aapl.symbol, "AAPL");
  assert.equal(aapl.decimals, 18);
});

test("the same pool discovered twice is held once", () => {
  // Chunk boundaries can hand back a log already seen, and a duplicated pool
  // is a duplicated position in everything downstream.
  assert.equal(watchable([pool(AAPL, USDG), pool(AAPL, USDG)]).length, 1);
});

test("a pool with both sides unknown is dropped, not half-read", () => {
  assert.equal(watchable([pool(STRANGER, STRANGER)]).length, 0);
});
