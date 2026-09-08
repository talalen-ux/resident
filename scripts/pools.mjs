/**
 * Find the pools worth being in, live, from an RPC alone.
 *
 *   RESIDENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
 *     node --experimental-strip-types scripts/pools.mjs
 *
 * Three steps, none of which need an indexer:
 *
 *   1. discover  — replay the PoolManager's Initialize logs to reconstruct
 *                  every pool key that exists
 *   2. observe   — read each pool's state, and its volume and age from Swap
 *                  and Initialize logs
 *   3. rank      — run the six gates, then the net test
 *
 * Discovery from block 0 is the expensive part and only changes when a pool is
 * created, so it is cached to .pools.json and reused. Delete that file, or pass
 * --rediscover, to scan again.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  RpcPoolsSource,
  discoverPools,
} from "../src/lib/desk/rpc-pools-source.ts";
import { buildBoard, DEFAULT_ALERT_CONFIG } from "../src/lib/sim/opportunity.ts";

const RPC = process.env.RESIDENT_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
if (!RPC) {
  console.error("Set RESIDENT_RPC_URL to an RPC that can serve eth_getLogs.");
  process.exit(1);
}

const CACHE = ".pools.json";
const rediscover = process.argv.includes("--rediscover");

let pools;
if (!rediscover && existsSync(CACHE)) {
  pools = JSON.parse(readFileSync(CACHE, "utf8"));
  console.log(`  ${pools.length} pools from ${CACHE} (--rediscover to rescan)`);
} else {
  process.stdout.write("  scanning Initialize logs… ");
  pools = await discoverPools(RPC);
  writeFileSync(CACHE, JSON.stringify(pools, null, 2));
  console.log(`found ${pools.length} pools, cached to ${CACHE}`);
}

if (!pools.length) {
  console.log("\n  No canonical pools found. Check the PoolManager address in src/lib/chain.ts.");
  process.exit(0);
}

const board = buildBoard(
  await new RpcPoolsSource(RPC, pools).observe(),
  DEFAULT_ALERT_CONFIG,
);

const usd = (n) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

console.log(`\n  QUALIFYING — ${board.qualifying.length}\n`);
if (!board.qualifying.length) console.log("  (none right now)");
for (const a of board.qualifying) {
  console.log(
    `  ${a.pair.padEnd(16)} ${usd(a.fees.h1).padStart(8)}/h  ` +
      `share ${(a.share * 100).toFixed(1)}%  depth ${usd(a.inBandLiquidity)}`,
  );
}

console.log(`\n  NOT QUALIFYING — ${board.rejected.length}\n`);
for (const a of board.rejected.slice(0, 12)) {
  const failed = a.gates.filter((g) => !g.passed).map((g) => g.name);
  console.log(`  ${a.pair.padEnd(16)} ${failed.join(", ")}`);
}

console.log(`
  Read at ${board.generatedAt}. The board ranks candidates; it does not open
  positions. "LPs winning" cannot be scored from pool state alone, so it needs
  a history source — until one is wired in that gate holds every pool rather
  than passing it unchecked, which is why NOT QUALIFYING may list them all.
`);
