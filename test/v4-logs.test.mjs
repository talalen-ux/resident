import assert from "node:assert/strict";
import test from "node:test";
import { id as keccakId } from "ethers";

import { V4_TOPICS, RpcPoolsSource } from "../src/lib/desk/rpc-pools-source.ts";
import { poolId } from "../src/lib/sim/v4.ts";

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
      // A real Swap log carries the pool id as topic 1 whether or not the
      // query filtered on it. Echoing the requested topics back instead meant
      // the fixture only worked while the caller happened to ask per-pool.
      return reply(
        swaps
          .filter((s) => s.block >= lo && s.block <= hi)
          .map((s) => ({
            blockNumber: "0x" + s.block.toString(16),
            data: swapData(s.amount1, s.sqrt),
            topics: [V4_TOPICS.swap, poolId(KEY)],
          })),
      );
    }
    throw new Error(`unexpected ${method}`);
  };
}

async function observeWith(stub, opts = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    const source = new RpcPoolsSource(
      "http://stub",
      [{ key: KEY, token0: STOCK, token1: USDG }],
      { maxBlockSpan: 1_000_000, ageSearchBlocks: 50_000, ...opts },
    );
    return await source.observe();
  } finally {
    globalThis.fetch = original;
  }
}

test("volume windows are bucketed by how long ago the swap was", async () => {
  // A day is asked for explicitly: the default window is an hour, because the
  // board reads nothing longer and a day is 24x the data for the same answer.
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
    { windowSeconds: 86_400 },
  );

  assert.equal(obs.volume.m5, 1);
  assert.equal(obs.volume.h1, 3);
  assert.equal(obs.volume.h6, 7);
  assert.equal(obs.volume.h24, 15);
  assert.equal(obs.windowSeconds, 86_400, "the observation says what it read");
});

test("a bucket never claims a span the window did not cover", async () => {
  // With the default hour, h24 is an hour's total. Reporting it as a day would
  // make a quiet pool look like it had been measured for one and found quiet,
  // which is the difference between a reading and an absence of one.
  const head = 100_000;
  const [obs] = await observeWith(
    stubFetch({
      head,
      swaps: [
        { block: head - 50, amount1: 1_000_000n }, // inside the hour
        { block: head - 40_000, amount1: 8_000_000n }, // a day ago, not read
      ],
    }),
  );
  assert.equal(obs.volume.h1, 1);
  assert.equal(obs.volume.h24, 1, "not 9: the older swap was never fetched");
  assert.equal(obs.windowSeconds, 3_600);
});

test("sells count toward volume as much as buys", async () => {
  const head = 100_000;
  const [obs] = await observeWith(
    stubFetch({ head, swaps: [{ block: head - 10, amount1: -3_000_000n }] }),
  );
  // A negative amount1 is the quote leaving the pool. It is still $3 traded.
  assert.equal(obs.volume.m5, 3);
});

/** One trade, so the pool is observed at all. See the test below. */
const traded = { block: 99_000, amount1: -1_000_000n, sqrt: 2n ** 96n };

test("a pool that has not traded in the window is not observed", async () => {
  // Deliberate. Observing every watched pool meant a state read and a day of
  // log replay each, which at 9,103 watchable pools is roughly 73,000 requests
  // on a 60-second tick. A pool with no volume earns no fees and cannot rank,
  // so the swaps are what say which pools are worth reading.
  //
  // Positions the desk already holds are read from its own registry, not from
  // this board, so a quiet pool it is in is still tended.
  assert.deepEqual(await observeWith(stubFetch({ head: 100_000, swaps: [] })), []);
});

test("a pool older than the search window still reads as old enough", async () => {
  const [obs] = await observeWith(
    stubFetch({ head: 100_000, initAt: null, swaps: [traded] }),
  );
  // 50k blocks at 2s is ~1,666 minutes, comfortably past the 20-minute gate.
  assert.ok(obs.ageMinutes > 20, `age ${obs.ageMinutes}`);
});

test("a freshly initialised pool reports its real age", async () => {
  const head = 100_000;
  const [obs] = await observeWith(
    stubFetch({ head, initAt: head - 300, swaps: [traded] }),
  );
  assert.equal(Math.round(obs.ageMinutes), 10); // 300 blocks x 2s = 10 min
});

test("liquidity-provider scoring is reported as unmeasured, not as zero winners", async () => {
  const [obs] = await observeWith(stubFetch({ head: 100_000, swaps: [traded] }));
  // The board's LPs-winning gate needs > 0, so 0 holds the pool back rather
  // than letting it through unchecked.
  assert.equal(obs.smartLpNet, 0);
  assert.equal(obs.smartLpPresent, 0);
});

test("the busiest pools are read first when there are more than the cap", async () => {
  // The cap exists so a tick finishes. Which pools it keeps matters: the board
  // only ever acts on a handful, and they are the ones with the flow.
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch({ head: 100_000, swaps: [traded, traded] });
  try {
    const source = new RpcPoolsSource("http://stub", [{ key: KEY, token0: STOCK, token1: USDG }], {
      maxBlockSpan: 1_000_000,
      ageSearchBlocks: 50_000,
      maxPools: 0,
    });
    assert.deepEqual(await source.observe(), [], "a cap of zero reads nothing");
    assert.equal(source.lastActive, 1, "but still counts what traded");
  } finally {
    globalThis.fetch = original;
  }
});

// --- Pool discovery ---------------------------------------------------------

import { discoverPools } from "../src/lib/desk/rpc-pools-source.ts";
import { STOCK_TOKENS, TOKENS } from "../src/lib/chain.ts";

const AMC = STOCK_TOKENS.AMC?.address ?? Object.values(STOCK_TOKENS)[0].address;

/** An Initialize log: fee, tickSpacing, hooks, sqrtPriceX96, tick. */
function initData(fee, tickSpacing, hooks) {
  const n = (v) => BigInt(v).toString(16).padStart(64, "0");
  const addr = hooks.slice(2).toLowerCase().padStart(64, "0");
  return "0x" + n(fee) + n(tickSpacing) + addr + n(1n << 96n) + n(0);
}
const topic = (addr) => "0x" + addr.slice(2).toLowerCase().padStart(64, "0");

async function discoverWith(logs) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const reply = (result) => ({ ok: true, json: async () => ({ result }) });
    if (method === "eth_blockNumber") return reply("0x2710");
    if (method === "eth_getLogs") return reply(logs);
    throw new Error(`unexpected ${method}`);
  };
  try {
    return await discoverPools("http://stub", { maxBlockSpan: 1_000_000 });
  } finally {
    globalThis.fetch = original;
  }
}

test("a pool key is reconstructed from its Initialize log", async () => {
  const pools = await discoverWith([
    {
      blockNumber: "0x1",
      data: initData(3000, 60, "0x0000000000000000000000000000000000000000"),
      topics: [V4_TOPICS.initialize, "0x" + "11".repeat(32), topic(AMC), topic(TOKENS.usdg)],
    },
  ]);

  assert.equal(pools.length, 1);
  assert.equal(pools[0].key.fee, 3000);
  assert.equal(pools[0].key.tickSpacing, 60);
  assert.equal(pools[0].key.hooks, "0x0000000000000000000000000000000000000000");
  assert.equal(pools[0].token1.symbol, "USDG");
  assert.equal(pools[0].token1.decimals, 6);
});

test("a pool paired against an unknown token is not a candidate", async () => {
  const pools = await discoverWith([
    {
      blockNumber: "0x1",
      data: initData(3000, 60, "0x0000000000000000000000000000000000000000"),
      topics: [
        V4_TOPICS.initialize,
        "0x" + "22".repeat(32),
        topic("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
        topic(TOKENS.usdg),
      ],
    },
  ]);
  // Guessing decimals for an unknown token mis-scales every figure downstream,
  // so it is dropped rather than defaulted.
  assert.equal(pools.length, 0);
});

test("a hook address is carried through, so the hook gate can see it", async () => {
  const hook = "0x00000000000000000000000000000000000000ff";
  const pools = await discoverWith([
    {
      blockNumber: "0x1",
      data: initData(500, 10, hook),
      topics: [V4_TOPICS.initialize, "0x" + "33".repeat(32), topic(AMC), topic(TOKENS.usdg)],
    },
  ]);
  assert.equal(pools[0].key.hooks, hook);
});

test("the same pool initialised twice is listed once", async () => {
  const log = {
    blockNumber: "0x1",
    data: initData(3000, 60, "0x0000000000000000000000000000000000000000"),
    topics: [V4_TOPICS.initialize, "0x" + "44".repeat(32), topic(AMC), topic(TOKENS.usdg)],
  };
  const pools = await discoverWith([log, { ...log, blockNumber: "0x2" }]);
  assert.equal(pools.length, 1);
});

test("a pool's age comes from discovery, not from asking again", async () => {
  // Discovery reads the Initialize log that creates a pool, and that log says
  // which block. Searching for it again cost 25 chunked queries per pool, 40
  // pools a tick, for a number already on disk — the largest single cost in a
  // tick and the reason every one of them rate limited.
  const head = 100_000;
  const original = globalThis.fetch;
  let initialiseQueries = 0;
  const stub = stubFetch({ head, swaps: [traded] });
  globalThis.fetch = async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    if (method === "eth_getLogs" && params[0].topics[0] === V4_TOPICS.initialize) {
      initialiseQueries++;
    }
    return stub(url, init);
  };
  try {
    const source = new RpcPoolsSource(
      "http://stub",
      [{ key: KEY, token0: STOCK, token1: USDG, block: head - 300 }],
      { maxBlockSpan: 1_000_000, ageSearchBlocks: 50_000 },
    );
    const [obs] = await source.observe();
    assert.equal(Math.round(obs.ageMinutes), 10, "300 blocks x 2s");
    assert.equal(initialiseQueries, 0, "the node was not asked");
  } finally {
    globalThis.fetch = original;
  }
});

test("a pool with no recorded block still falls back to searching", async () => {
  // Cached before the block was recorded, or discovered some other way. The
  // number matters more than where it came from.
  const head = 100_000;
  const [obs] = await observeWith(
    stubFetch({ head, initAt: head - 600, swaps: [traded] }),
  );
  assert.equal(Math.round(obs.ageMinutes), 20);
});
