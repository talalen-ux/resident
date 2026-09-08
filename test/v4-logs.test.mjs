import assert from "node:assert/strict";
import test from "node:test";
import { id as keccakId } from "ethers";

import { V4_TOPICS, RpcPoolsSource } from "../src/lib/desk/rpc-pools-source.ts";

/**
 * A wrong topic hash does not throw — eth_getLogs just returns nothing, which
 * reads as "this pool never traded" and drops every candidate off the board.
 * Same failure mode as the eight hand-written selectors that were wrong, so the
 * same treatment: derive them and compare.
 */
test("swap and initialize topics match their canonical signatures", () => {
  assert.equal(
    V4_TOPICS.swap,
    keccakId("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"),
  );
  assert.equal(
    V4_TOPICS.initialize,
    keccakId("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"),
  );
});

const USDG = { symbol: "USDG", decimals: 6 };
const STOCK = { symbol: "AMC", decimals: 18 };
const KEY = {
  currency0: "0x0000000000000000000000000000000000000001",
  currency1: "0x0000000000000000000000000000000000000002",
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000",
};

/** A Swap log body: amount0, amount1, sqrtPriceX96, liquidity, tick, fee. */
function swapData(amount1, sqrtPriceX96 = 1n << 96n) {
  const w = (v) => {
    const raw = v < 0n ? (1n << 256n) + v : v;
    return raw.toString(16).padStart(64, "0");
  };
  return "0x" + w(0n) + w(amount1) + w(sqrtPriceX96) + w(0n) + w(0n) + w(0n);
}

/** Stub RPC: two blocks a second, swaps at known ages. */
function stubFetch({ head = 100_000, swaps = [], initAt = null }) {
  return async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    const reply = (result) => ({ ok: true, json: async () => ({ result }) });

    if (method === "eth_blockNumber") return reply("0x" + head.toString(16));
    if (method === "eth_getBlockByNumber") {
      const n = Number(BigInt(params[0]));
      return reply({ timestamp: "0x" + (n * 2).toString(16) }); // 2s per block
    }
    if (method === "eth_call") return reply("0x" + "0".repeat(64));
    if (method === "eth_getLogs") {
      const [{ topics, fromBlock, toBlock }] = params;
      const lo = Number(BigInt(fromBlock));
      const hi = Number(BigInt(toBlock));
      if (topics[0] === V4_TOPICS.initialize) {
        return reply(
          initAt !== null && initAt >= lo && initAt <= hi
            ? [{ blockNumber: "0x" + initAt.toString(16), data: "0x", topics }]
            : [],
        );
      }
      return reply(
        swaps
          .filter((s) => s.block >= lo && s.block <= hi)
          .map((s) => ({
            blockNumber: "0x" + s.block.toString(16),
            data: swapData(s.amount1, s.sqrt),
            topics,
          })),
      );
    }
    throw new Error(`unexpected ${method}`);
  };
}

async function observeWith(stub) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    const source = new RpcPoolsSource(
      "http://stub",
      [{ key: KEY, token0: STOCK, token1: USDG }],
      { maxBlockSpan: 1_000_000, ageSearchBlocks: 50_000 },
    );
    return await source.observe();
  } finally {
    globalThis.fetch = original;
  }
}

test("volume windows are bucketed by how long ago the swap was", async () => {
  const head = 100_000;
  // 2s per block: 5m = 150 blocks, 1h = 1800, 6h = 10800, 24h = 43200.
  const [obs] = await observeWith(
    stubFetch({
      head,
      swaps: [
        { block: head - 50, amount1: 1_000_000n }, // $1, inside 5m
        { block: head - 1_000, amount1: 2_000_000n }, // $2, inside 1h
        { block: head - 5_000, amount1: 4_000_000n }, // $4, inside 6h
        { block: head - 40_000, amount1: 8_000_000n }, // $8, inside 24h
        { block: head - 60_000, amount1: 99_000_000n }, // older, excluded
      ],
    }),
  );

  assert.equal(obs.volume.m5, 1);
  assert.equal(obs.volume.h1, 3);
  assert.equal(obs.volume.h6, 7);
  assert.equal(obs.volume.h24, 15);
});

test("sells count toward volume as much as buys", async () => {
  const head = 100_000;
  const [obs] = await observeWith(
    stubFetch({ head, swaps: [{ block: head - 10, amount1: -3_000_000n }] }),
  );
  // A negative amount1 is the quote leaving the pool. It is still $3 traded.
  assert.equal(obs.volume.m5, 3);
});

test("a pool older than the search window still reads as old enough", async () => {
  const [obs] = await observeWith(stubFetch({ head: 100_000, initAt: null }));
  // 50k blocks at 2s is ~1,666 minutes, comfortably past the 20-minute gate.
  assert.ok(obs.ageMinutes > 20, `age ${obs.ageMinutes}`);
});

test("a freshly initialised pool reports its real age", async () => {
  const head = 100_000;
  const [obs] = await observeWith(stubFetch({ head, initAt: head - 300 }));
  assert.equal(Math.round(obs.ageMinutes), 10); // 300 blocks x 2s = 10 min
});

test("liquidity-provider scoring is reported as unmeasured, not as zero winners", async () => {
  const [obs] = await observeWith(stubFetch({ head: 100_000 }));
  // The board's LPs-winning gate needs > 0, so 0 holds the pool back rather
  // than letting it through unchecked.
  assert.equal(obs.smartLpNet, 0);
  assert.equal(obs.smartLpPresent, 0);
});
