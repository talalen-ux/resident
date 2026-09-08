/**
 * Where pool state comes from.
 *
 * `RpcPoolSource` reads a live Uniswap v3 pool over JSON-RPC — slot0, liquidity,
 * the immutables, and a window of initialised ticks around the current price.
 * That is the source the simulator is meant to run on.
 *
 * `FixturePoolSource` builds a pool from parameters, for exercising the engine
 * where no chain is reachable. Anything it returns is constructed, not observed.
 */

import { sqrtPriceAtTick, type PoolState, type Tick } from "./v3.ts";

export interface PoolSource {
  readonly kind: "rpc" | "fixture";
  load(pool: string): Promise<PoolState>;
}

// Selectors on IUniswapV3Pool.
const SEL = {
  slot0: "0x3850c7bd",
  liquidity: "0x1a686502",
  fee: "0xddca3f43",
  tickSpacing: "0xd0c93a7c",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  ticks: "0xf30dba93", // ticks(int24)
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
} as const;

const hexToBig = (h: string) => (h && h !== "0x" ? BigInt(h) : 0n);
const word = (hex: string, i: number) => "0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64);

/** Two's-complement decode of a signed word. */
function signed(hex: string): bigint {
  const v = hexToBig(hex);
  return v >= 2n ** 255n ? v - 2n ** 256n : v;
}

function encodeInt24(value: number): string {
  const v = BigInt(value) & ((1n << 256n) - 1n);
  return v.toString(16).padStart(64, "0");
}

export class RpcPoolSource implements PoolSource {
  readonly kind = "rpc";

  // Declared explicitly rather than as constructor parameter properties: this
  // module is run directly by scripts/simulate.mjs under Node's strip-only
  // TypeScript mode, which does not support that shorthand.
  private readonly rpcUrl: string;
  /** How many tickSpacings either side of spot to load. */
  private readonly tickRadius: number;

  constructor(rpcUrl: string, tickRadius = 40) {
    this.rpcUrl = rpcUrl;
    this.tickRadius = tickRadius;
  }

  private async call(to: string, data: string): Promise<string> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`RPC: ${json.error.message}`);
    return json.result as string;
  }

  private async erc20(address: string) {
    const [dec, sym] = await Promise.all([
      this.call(address, SEL.decimals),
      this.call(address, SEL.symbol).catch(() => "0x"),
    ]);
    let symbol = "?";
    try {
      // Standard dynamic string: offset, length, data.
      const len = Number(hexToBig(word(sym, 1)));
      const bytes = sym.slice(2 + 2 * 64, 2 + 2 * 64 + len * 2);
      symbol = Buffer.from(bytes, "hex").toString("utf8") || "?";
    } catch {}
    return { symbol, decimals: Number(hexToBig(dec)) };
  }

  async load(pool: string): Promise<PoolState> {
    const [slot0, liquidity, fee, spacing, t0, t1] = await Promise.all([
      this.call(pool, SEL.slot0),
      this.call(pool, SEL.liquidity),
      this.call(pool, SEL.fee),
      this.call(pool, SEL.tickSpacing),
      this.call(pool, SEL.token0),
      this.call(pool, SEL.token1),
    ]);

    const sqrtPriceX96 = hexToBig(word(slot0, 0));
    const tick = Number(signed(word(slot0, 1)));
    const tickSpacing = Number(hexToBig(spacing));

    const [token0, token1] = await Promise.all([
      this.erc20("0x" + t0.slice(-40)),
      this.erc20("0x" + t1.slice(-40)),
    ]);

    // Initialised ticks around spot. Each ticks() call returns
    // (liquidityGross, liquidityNet, ...); liquidityNet is the second word.
    const base = Math.floor(tick / tickSpacing) * tickSpacing;
    const indices: number[] = [];
    for (let i = -this.tickRadius; i <= this.tickRadius; i++) {
      indices.push(base + i * tickSpacing);
    }

    const ticks: Tick[] = [];
    const results = await Promise.all(
      indices.map((idx) =>
        this.call(pool, SEL.ticks + encodeInt24(idx)).catch(() => "0x"),
      ),
    );
    results.forEach((raw, i) => {
      if (!raw || raw === "0x") return;
      const liquidityNet = signed(word(raw, 1));
      if (liquidityNet !== 0n) ticks.push({ index: indices[i], liquidityNet });
    });

    return {
      sqrtPriceX96,
      liquidity: hexToBig(liquidity),
      tick,
      fee: Number(hexToBig(fee)),
      tickSpacing,
      ticks,
      token0,
      token1,
    };
  }
}

export type FixtureSpec = {
  price: number;
  liquidity: bigint;
  fee: number;
  token0?: { symbol: string; decimals: number; address?: string };
  token1?: { symbol: string; decimals: number; address?: string };
  ticks?: Tick[];
};

export class FixturePoolSource implements PoolSource {
  readonly kind = "fixture";

  private readonly specs: Record<string, FixtureSpec>;

  constructor(specs: Record<string, FixtureSpec>) {
    this.specs = specs;
  }

  async load(pool: string): Promise<PoolState> {
    const spec = this.specs[pool];
    if (!spec) throw new Error(`no fixture named ${pool}`);
    return buildPool(spec);
  }
}

/** Construct a pool state from human parameters. */
export function buildPool(spec: FixtureSpec): PoolState {
  const token0 = spec.token0 ?? { symbol: "STOCK", decimals: 18 };
  const token1 = spec.token1 ?? { symbol: "USDG", decimals: 6 };
  const raw = spec.price * 10 ** (token1.decimals - token0.decimals);
  return {
    sqrtPriceX96: BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96)),
    liquidity: spec.liquidity,
    tick: Math.floor(Math.log(raw) / Math.log(1.0001)),
    fee: spec.fee,
    tickSpacing: 60,
    ticks: spec.ticks ?? [],
    token0,
    token1,
  };
}

export { sqrtPriceAtTick };
