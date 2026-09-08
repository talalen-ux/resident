/**
 * Uniswap v4 pool reads.
 *
 * v4 is a singleton: there is no per-pool contract to call. Every pool lives
 * inside PoolManager, addressed by a `PoolId` derived from its key, and state is
 * read through the StateView periphery contract. The v3 reader in pools.ts —
 * which calls slot0() on a pool address — cannot see any of it.
 *
 * That matters because v4 is where the volume is: roughly half of all DEX trades
 * on Robinhood Chain, against about a third on v3, and the live positions this
 * desk is calibrated against are all v4 pools.
 */

import { AbiCoder, keccak256 } from "ethers";

import { UNISWAP } from "../chain.ts";
import type { PoolState, Tick, TokenMeta } from "./v3.ts";

/** The tuple identifying a v4 pool. Currencies must be sorted ascending. */
export type PoolKey = {
  currency0: string;
  currency1: string;
  /** Fee in hundredths of a bip. */
  fee: number;
  tickSpacing: number;
  /** Zero address when the pool runs no hook. */
  hooks: string;
};

/** StateView selectors, derived from the ABI rather than written by hand. */
export const V4_SELECTORS = {
  getSlot0: "0xc815641c",
  getLiquidity: "0xfa6793d5",
  getTickLiquidity: "0xcaedab54",
} as const;

const abi = AbiCoder.defaultAbiCoder();

/**
 * PoolId = keccak256(abi.encode(PoolKey)).
 *
 * Currencies must already be sorted — v4 does not sort them for you, and an
 * unsorted key hashes to a pool that does not exist rather than failing loudly.
 */
export function poolId(key: PoolKey): string {
  const [a, b] = [key.currency0.toLowerCase(), key.currency1.toLowerCase()];
  if (a >= b) {
    throw new Error(
      `PoolKey currencies must be sorted ascending: ${key.currency0} >= ${key.currency1}`,
    );
  }
  return keccak256(
    abi.encode(
      ["address", "address", "uint24", "int24", "address"],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Sort two token addresses into a valid currency pair. */
export function sortCurrencies(a: string, b: string): [string, string] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

const hexToBig = (h: string) => (h && h !== "0x" ? BigInt(h) : 0n);
const word = (hex: string, i: number) => "0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64);

/**
 * Two's-complement decode of a signed ABI word.
 *
 * Always 256 bits, regardless of the declared type: ABI encoding sign-extends
 * int24 and int128 across the full word, so decoding at the native width reads
 * a negative value as an enormous positive one. That would corrupt every tick
 * below price 1.0 and every liquidityNet on the lower side of a range.
 */
function signed(hex: string): bigint {
  const v = hexToBig(hex);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

function encodeInt24(value: number): string {
  return ((BigInt(value) & ((1n << 256n) - 1n)).toString(16)).padStart(64, "0");
}

export type V4Reader = {
  stateView: string;
  call: (to: string, data: string) => Promise<string>;
};

/**
 * Read a v4 pool into the same PoolState the swap engine already consumes, so
 * every gate, probe and backtest works on v4 unchanged.
 */
export async function readV4Pool(
  reader: V4Reader,
  key: PoolKey,
  token0: TokenMeta,
  token1: TokenMeta,
  /** How many tickSpacings either side of spot to load. */
  tickRadius = 40,
): Promise<PoolState> {
  const id = poolId(key);
  const arg = id.slice(2);

  const [slot0, liquidity] = await Promise.all([
    reader.call(reader.stateView, V4_SELECTORS.getSlot0 + arg),
    reader.call(reader.stateView, V4_SELECTORS.getLiquidity + arg),
  ]);

  const sqrtPriceX96 = hexToBig(word(slot0, 0));
  const tick = Number(signed(word(slot0, 1)));
  // slot0 also returns protocolFee and lpFee; lpFee is the one that is charged
  // and can differ from the key's static fee when a hook overrides it.
  const lpFee = Number(hexToBig(word(slot0, 3))) || key.fee;

  const base = Math.floor(tick / key.tickSpacing) * key.tickSpacing;
  const indices: number[] = [];
  for (let i = -tickRadius; i <= tickRadius; i++) indices.push(base + i * key.tickSpacing);

  const raw = await Promise.all(
    indices.map((idx) =>
      reader
        .call(reader.stateView, V4_SELECTORS.getTickLiquidity + arg + encodeInt24(idx))
        .catch(() => "0x"),
    ),
  );

  const ticks: Tick[] = [];
  raw.forEach((r, i) => {
    if (!r || r === "0x") return;
    // (liquidityGross, liquidityNet) — liquidityNet is the second word, signed.
    const liquidityNet = signed(word(r, 1));
    if (liquidityNet !== 0n) ticks.push({ index: indices[i], liquidityNet });
  });

  return {
    sqrtPriceX96,
    liquidity: hexToBig(liquidity),
    tick,
    fee: lpFee,
    tickSpacing: key.tickSpacing,
    ticks,
    token0,
    token1,
    stockIsToken1: token1.symbol !== "USDG" && token1.symbol !== "WETH",
  };
}

/** JSON-RPC reader against the deployed StateView. */
export function rpcReader(rpcUrl: string, stateView = UNISWAP.v4StateView): V4Reader {
  return {
    stateView,
    async call(to, data) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to, data }, "latest"],
        }),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`RPC: ${json.error.message}`);
      return json.result as string;
    },
  };
}

/**
 * A hook can take the LP's fee, which is why the opportunity board gates on
 * hook-free pools. The zero address means no hook.
 */
export const hasHook = (key: PoolKey) =>
  key.hooks !== "0x0000000000000000000000000000000000000000";
