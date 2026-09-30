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

/* --------------------------------------------- what is worth remembering */

test("a pool with a known side is kept; one with neither is not", async () => {
  // The cache the next boot has to parse. A chain this size is mostly spam
  // against spam, and a pool with no priceable side is one the board could
  // never rank — the same rule, applied earlier.
  const { discoverRawPools } = await import("../src/lib/desk/rpc-pools-source.ts");
  const { V4_TOPICS } = await import("../src/lib/desk/rpc-pools-source.ts");

  const topic = (a) => `0x${a.slice(2).padStart(64, "0")}`;
  const SPAM_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const SPAM_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  // fee, tickSpacing, hooks, sqrtPriceX96, tick
  const data = "0x" + [3000, 60, 0, 0, 0].map((n) => BigInt(n).toString(16).padStart(64, "0")).join("");

  const logs = [
    { topics: [V4_TOPICS.swap, "0x00", topic(SPAM_A), topic(TOKENS.usdg)], data, blockNumber: "0x1" },
    { topics: [V4_TOPICS.swap, "0x00", topic(SPAM_A), topic(SPAM_B)], data, blockNumber: "0x2" },
  ];

  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const reply = (result) => ({ ok: true, json: async () => ({ result }) });
    if (method === "eth_blockNumber") return reply("0x2");
    if (method === "eth_getCode") return reply("0x");
    if (method === "eth_getLogs") return reply(logs);
    throw new Error(`unexpected ${method}`);
  };
  try {
    const { pools } = await discoverRawPools("http://stub", { fromBlock: 0, maxBlockSpan: 10 });
    assert.equal(pools.length, 1, "only the pool with a priceable side");
    assert.ok(
      [pools[0].key.currency0, pools[0].key.currency1].includes(TOKENS.usdg.toLowerCase()) ||
        [pools[0].key.currency0, pools[0].key.currency1].includes(TOKENS.usdg),
    );
  } finally {
    globalThis.fetch = original;
  }
});

/* ------------------------------------- ranges the node refuses for size */

test("a range refused for size is halved, not abandoned", async () => {
  // The block span is a guess; the node's real limit is on results. A span
  // that works over quiet history fails on a busy stretch — which is exactly
  // where the logs worth having are.
  const { discoverRawPools, V4_TOPICS } = await import("../src/lib/desk/rpc-pools-source.ts");
  const { TOKENS: T } = await import("../src/lib/chain.ts");

  const topic = (a) => `0x${a.slice(2).padStart(64, "0")}`;
  const data = "0x" + [3000, 60, 0, 0, 0].map((n) => BigInt(n).toString(16).padStart(64, "0")).join("");
  const asked = [];

  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    const reply = (result) => ({ ok: true, json: async () => ({ result }) });
    if (method === "eth_blockNumber") return reply("0x64"); // 100
    if (method === "eth_getCode") return reply("0x");
    if (method === "eth_getLogs") {
      const [{ fromBlock, toBlock }] = params;
      const lo = Number(BigInt(fromBlock));
      const hi = Number(BigInt(toBlock));
      asked.push([lo, hi]);
      // Anything wider than 25 blocks is "too much", as a busy node would say.
      if (hi - lo + 1 > 25) {
        return {
          ok: true,
          json: async () => ({ error: { message: "logs matched by query exceeds limit of 10000" } }),
        };
      }
      return reply([
        {
          topics: [V4_TOPICS.initialize, "0x00", topic("0xcccccccccccccccccccccccccccccccccccccccc"), topic(T.usdg)],
          data,
          blockNumber: hex0(lo),
        },
      ]);
    }
    throw new Error(`unexpected ${method}`);
  };
  function hex0(n) { return "0x" + n.toString(16); }

  try {
    const { pools } = await discoverRawPools("http://stub", { fromBlock: 0, maxBlockSpan: 100 });
    assert.ok(pools.length > 0, "the scan completed rather than throwing");
    // One refusal at 100 wide, then halves until each range is accepted.
    assert.ok(asked.some(([lo, hi]) => hi - lo + 1 > 25), "the wide range was attempted");
    assert.ok(asked.every(([lo, hi]) => lo <= hi), "no inverted ranges");
    assert.ok(asked.length >= 7, `expected subdivision, got ${asked.length} queries`);
  } finally {
    globalThis.fetch = original;
  }
});

test("a single block the node still refuses is surfaced, not faked", async () => {
  // Splitting bottoms out. Inventing a partial answer would under-report
  // volume as though the pool had been quiet.
  const { discoverRawPools } = await import("../src/lib/desk/rpc-pools-source.ts");
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    if (method === "eth_blockNumber") return { ok: true, json: async () => ({ result: "0x2" }) };
    if (method === "eth_getCode") return { ok: true, json: async () => ({ result: "0x" }) };
    return {
      ok: true,
      json: async () => ({ error: { message: "logs matched by query exceeds limit of 10000" } }),
    };
  };
  try {
    await assert.rejects(
      discoverRawPools("http://stub", { fromBlock: 0, maxBlockSpan: 10 }),
      /exceeds limit/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
