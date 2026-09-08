/**
 * Uniswap v4 pool reads.
 *
 * There is no chain to read here, so the reader is driven by a stub that
 * answers the same ABI. That tests what can be tested offline — the PoolId
 * derivation, the decoding, and the fact that a v4 pool arrives as the same
 * PoolState every other engine already consumes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { AbiCoder, keccak256 } from "ethers";

import {
  V4_SELECTORS,
  hasHook,
  poolId,
  readV4Pool,
  sortCurrencies,
} from "../src/lib/sim/v4.ts";
import { spotPrice, swapExactIn } from "../src/lib/sim/v3.ts";
import { TOKENS, STOCK_TOKENS } from "../src/lib/chain.ts";

const ZERO = "0x0000000000000000000000000000000000000000";
const abi = AbiCoder.defaultAbiCoder();

const key = {
  currency0: "0x1111111111111111111111111111111111111111",
  currency1: "0x2222222222222222222222222222222222222222",
  fee: 5000,
  tickSpacing: 100,
  hooks: ZERO,
};

// --- pool identity ----------------------------------------------------------

test("PoolId is keccak of the encoded key", () => {
  const expected = keccak256(
    abi.encode(
      ["address", "address", "uint24", "int24", "address"],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
  assert.equal(poolId(key), expected);
  assert.match(poolId(key), /^0x[0-9a-f]{64}$/);
});

test("every field changes the pool it identifies", () => {
  const base = poolId(key);
  assert.notEqual(poolId({ ...key, fee: 3000 }), base);
  assert.notEqual(poolId({ ...key, tickSpacing: 60 }), base);
  assert.notEqual(poolId({ ...key, hooks: "0x00000000000000000000000000000000000000ff" }), base);
});

test("unsorted currencies are refused rather than hashing to nothing", () => {
  // v4 does not sort for you: an unsorted key names a pool that does not exist,
  // and a read against it returns zeros rather than an error.
  assert.throws(
    () => poolId({ ...key, currency0: key.currency1, currency1: key.currency0 }),
    /sorted ascending/,
  );
});

test("sortCurrencies produces a usable pair either way round", () => {
  const [a, b] = sortCurrencies(TOKENS.usdg, STOCK_TOKENS.AMC.address);
  const [c, d] = sortCurrencies(STOCK_TOKENS.AMC.address, TOKENS.usdg);
  assert.equal(a, c);
  assert.equal(b, d);
  assert.ok(a.toLowerCase() < b.toLowerCase());
  assert.doesNotThrow(() => poolId({ ...key, currency0: a, currency1: b }));
});

test("a hooked pool is identified as such", () => {
  assert.equal(hasHook(key), false);
  assert.equal(hasHook({ ...key, hooks: "0x00000000000000000000000000000000000000aa" }), true);
});

// --- reading ----------------------------------------------------------------

/** Stub StateView answering the three calls the reader makes. */
function stubReader({ sqrtPriceX96, tick, lpFee, liquidity, ticks = {} }) {
  const calls = [];
  return {
    calls,
    reader: {
      stateView: "0xstate",
      async call(_to, data) {
        calls.push(data.slice(0, 10));
        if (data.startsWith(V4_SELECTORS.getSlot0)) {
          return abi.encode(
            ["uint160", "int24", "uint24", "uint24"],
            [sqrtPriceX96, tick, 0, lpFee],
          );
        }
        if (data.startsWith(V4_SELECTORS.getLiquidity)) {
          return abi.encode(["uint128"], [liquidity]);
        }
        if (data.startsWith(V4_SELECTORS.getTickLiquidity)) {
          // Trailing arg is the int24 tick, two's complement in a full word.
          const raw = BigInt("0x" + data.slice(74));
          const asInt = raw >= 1n << 255n ? raw - (1n << 256n) : raw;
          const net = ticks[Number(asInt)] ?? 0n;
          return abi.encode(["uint128", "int128"], [net < 0n ? -net : net, net]);
        }
        return "0x";
      },
    },
  };
}

const usdg = { symbol: "USDG", decimals: 6, address: TOKENS.usdg };
const stock = { symbol: "AMC", decimals: 18, address: STOCK_TOKENS.AMC.address };

test("a v4 pool decodes into the PoolState the engines already consume", async () => {
  const price = 5;
  const raw = price * 10 ** (6 - 18);
  const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96));
  const tick = Math.floor(Math.log(raw) / Math.log(1.0001));

  const { reader } = stubReader({
    sqrtPriceX96, tick, lpFee: 5000, liquidity: 20_000n * 10n ** 12n,
  });

  const pool = await readV4Pool(reader, key, stock, usdg, 2);

  assert.equal(pool.fee, 5000);
  assert.equal(pool.tickSpacing, 100);
  assert.equal(pool.liquidity, 20_000n * 10n ** 12n);
  assert.ok(Math.abs(spotPrice(pool) - price) / price < 1e-6);

  // And the existing swap engine runs on it unchanged.
  const res = swapExactIn(pool, true, 10n ** 18n);
  assert.ok(res.amountOut > 0n);
});

test("the lp fee from slot0 wins over the key's static fee", async () => {
  // A hook can override the fee charged, so the key's value is not authoritative.
  const { reader } = stubReader({
    sqrtPriceX96: 2n ** 96n, tick: 0, lpFee: 12345, liquidity: 1000n,
  });
  const pool = await readV4Pool(reader, { ...key, fee: 5000 }, stock, usdg, 0);
  assert.equal(pool.fee, 12345, "the charged fee is the one slot0 reports");
});

test("initialised ticks are decoded with their sign", async () => {
  const { reader } = stubReader({
    sqrtPriceX96: 2n ** 96n, tick: 0, lpFee: 3000, liquidity: 1000n,
    ticks: { 100: 5000n, "-100": -3000n },
  });
  const pool = await readV4Pool(reader, key, stock, usdg, 2);

  const up = pool.ticks.find((t) => t.index === 100);
  const down = pool.ticks.find((t) => t.index === -100);
  assert.equal(up?.liquidityNet, 5000n);
  assert.equal(down?.liquidityNet, -3000n, "liquidityNet is signed and must survive decoding");
  assert.equal(pool.ticks.length, 2, "uninitialised ticks are dropped");
});

test("token ordering is recorded so a pool is never read upside down", async () => {
  const { reader } = stubReader({
    sqrtPriceX96: 2n ** 96n, tick: 0, lpFee: 3000, liquidity: 1000n,
  });

  const stockToken0 = await readV4Pool(reader, key, stock, usdg, 0);
  assert.equal(stockToken0.stockIsToken1, false);

  const stockToken1 = await readV4Pool(reader, key, usdg, stock, 0);
  assert.equal(stockToken1.stockIsToken1, true);
});

test("the reader asks for exactly the ticks requested and no more", async () => {
  const { reader, calls } = stubReader({
    sqrtPriceX96: 2n ** 96n, tick: 0, lpFee: 3000, liquidity: 1000n,
  });
  await readV4Pool(reader, key, stock, usdg, 3);

  const tickCalls = calls.filter((c) => c === V4_SELECTORS.getTickLiquidity);
  assert.equal(tickCalls.length, 7, "radius 3 is 7 ticks either side inclusive");
  assert.equal(calls.filter((c) => c === V4_SELECTORS.getSlot0).length, 1);
});

test("negative ticks survive decoding", async () => {
  // Any pool priced below 1.0 sits at a negative tick — which is most memecoin
  // pairs. ABI sign-extends int24 across the full word, so decoding at 24 bits
  // turns −201900 into an enormous positive number and the pool reads as being
  // at a wildly wrong price.
  const { reader } = stubReader({
    sqrtPriceX96: 2n ** 96n / 1000n, tick: -201900, lpFee: 3000, liquidity: 1000n,
    ticks: { "-201800": -7000n },
  });
  const pool = await readV4Pool(reader, key, stock, usdg, 1);

  assert.equal(pool.tick, -201900);
  assert.equal(pool.ticks.find((t) => t.index === -201800)?.liquidityNet, -7000n);
});
