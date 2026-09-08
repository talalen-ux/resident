#!/usr/bin/env node
/**
 * Run the desk's decision logic against pools.
 *
 *   # against real pools — needs an RPC this machine can reach
 *   node --experimental-strip-types scripts/simulate.mjs \
 *     --rpc https://... --pool 0xabc... --reference 4.82 \
 *     --inventory 5000 --basis 4.10
 *
 *   # against constructed scenarios, when no chain is reachable
 *   node --experimental-strip-types scripts/simulate.mjs --scenarios
 *
 * The two paths run identical code. Only the pool source differs, and the
 * output says which one produced the numbers.
 */

import { evaluate, classify, DEFAULT_PARAMS } from "../src/lib/sim/desk.ts";
import { spotPrice, swapExactIn } from "../src/lib/sim/v3.ts";
import { RpcPoolSource, buildPool } from "../src/lib/sim/pools.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]] : [],
  ),
);

const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const pad = (s, n) => String(s).padEnd(n);

function report(label, pool, verdict, cls) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`${label}   ${pool.token0.symbol}/${pool.token1.symbol}  fee ${pool.fee / 10_000}%`);
  console.log("─".repeat(72));
  console.log(`  spot                ${money(verdict.spot)}`);
  console.log(`  reference P̂         ${money(verdict.reference)}`);
  console.log(`  deviation δ         ${pct(verdict.deviation)}`);
  if (cls) {
    console.log(`  impact I($1k)       ${cls.impact1k === null ? "no fill" : pct(cls.impact1k)}`);
    console.log(`  impact I($10k)      ${cls.impact10k === null ? "no fill" : pct(cls.impact10k)}`);
    console.log(`  survey              ${cls.classification} — ${cls.reason}`);
  }
  console.log(`  probe Φ             ${verdict.probe.filled ? money(verdict.probe.yield) : "no fill"}` +
    `${verdict.probe.filled ? (verdict.probe.passed ? "  (passes φ_min)" : "  (under φ_min)") : ""}`);

  if (verdict.sizing) {
    const s = verdict.sizing;
    console.log(`  floor               ${money(s.floor)}`);
    console.log(`  S*                  ${s.maxSize.toFixed(4)} ${pool.token0.symbol}`);
    console.log(`  tranche τ·S*        ${s.trancheSize.toFixed(4)} ${pool.token0.symbol}`);
    console.log(`  effective price     ${money(s.effectivePrice)}`);
    console.log(`  proceeds            ${money(s.proceeds)}`);
    console.log(`  profit              ${money(s.profit)}`);
  }
  console.log(`  verdict             ${verdict.actionable ? "ACTIONABLE" : "rejected — " + verdict.blockedBy}`);
}

/**
 * Constructed scenarios. These are NOT real pools — they exist to exercise each
 * branch of the gate, including the ones that should reject.
 */
const SCENARIOS = [
  { label: "1. Real dislocation, thin book",
    spec: { price: 9.10, liquidity: 20_000n * 10n ** 12n, fee: 3000, token0: { symbol: "BBBY", decimals: 18 } },
    reference: 5.00, inventory: 8_000, basis: 4.40 },
  { label: "2. Mirage — spectacular print, empty book",
    spec: { price: 26.00, liquidity: 0n, fee: 10000, token0: { symbol: "KOSS", decimals: 18 } },
    reference: 5.00, inventory: 2_000, basis: 4.80 },
  { label: "3. Quiet pool, below δ*",
    spec: { price: 5.30, liquidity: 200_000n * 10n ** 12n, fee: 500, token0: { symbol: "GME", decimals: 18 } },
    reference: 5.00, inventory: 1_000, basis: 4.60 },
  { label: "4. Deep instrument — excluded by the survey",
    // Deep books sit near reference precisely because they get arbitraged.
    spec: { price: 5.02, liquidity: 40_000_000n * 10n ** 12n, fee: 500, token0: { symbol: "NVDA", decimals: 18 } },
    reference: 5.00, inventory: 1_000, basis: 4.50 },
  { label: "5. Dislocated, but under the desk's own basis",
    spec: { price: 7.00, liquidity: 30_000n * 10n ** 12n, fee: 3000, token0: { symbol: "EXPR", decimals: 18 } },
    reference: 5.00, inventory: 1_000, basis: 9.00 },
  { label: "6. Structural artifact — pool initialised at a boundary",
    spec: { price: 5_000, liquidity: 10n ** 12n, fee: 10000, token0: { symbol: "PARK", decimals: 18 } },
    reference: 5.00, inventory: 100, basis: 4.00 },
];

async function runScenarios() {
  console.log("\n  SOURCE: constructed scenarios — these are not real pools.");
  console.log("  No chain RPC is reachable from here; every figure below is built");
  console.log("  from the parameters in scripts/simulate.mjs, not observed on-chain.");
  console.log(`  Params: δ*=${pct(DEFAULT_PARAMS.minDeviation)} ε=${pct(DEFAULT_PARAMS.executionEdge)} ` +
    `τ=${DEFAULT_PARAMS.trancheFraction} π_min=$${DEFAULT_PARAMS.minProfit} φ_min=$${DEFAULT_PARAMS.probeMinYield}`);

  let actionable = 0;
  for (const s of SCENARIOS) {
    const pool = buildPool(s.spec);
    const verdict = evaluate(pool, s.spec.token0.symbol, s.reference, s.inventory, s.basis);
    const cls = classify(pool, s.reference);
    report(s.label, pool, verdict, cls);
    if (verdict.actionable) actionable++;
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log(`  ${actionable} of ${SCENARIOS.length} scenarios actionable.`);
  console.log(`${"─".repeat(72)}\n`);
}

async function runLive() {
  const source = new RpcPoolSource(args.rpc);
  const pool = await source.load(args.pool);
  const reference = Number(args.reference ?? spotPrice(pool));
  const inventory = Number(args.inventory ?? 1_000);
  const basis = Number(args.basis ?? 0);

  console.log(`\n  SOURCE: live pool ${args.pool}`);
  console.log(`  liquidity ${pool.liquidity} · tick ${pool.tick} · ${pool.ticks.length} initialised ticks loaded`);

  const verdict = evaluate(pool, pool.token0.symbol, reference, inventory, basis, {
    sessionOpen: args.closed ? false : true,
  });
  report("live", pool, verdict, classify(pool, reference));

  // Depth ladder: what the book actually pays at increasing size.
  console.log(`\n  Depth ladder (effective price by size)`);
  for (const size of [1, 10, 100, 1_000, 10_000]) {
    const amt = BigInt(Math.floor(size * 10 ** pool.token0.decimals));
    const res = swapExactIn(pool, true, amt);
    const eff = Number(res.amountOut) / 10 ** pool.token1.decimals / size;
    console.log(`    ${pad(size + " " + pool.token0.symbol, 20)} ${pad(money(eff), 14)} ` +
      `${pct(eff / reference - 1)}${res.exhausted ? "  (book exhausted)" : ""}`);
  }
  console.log();
}

if (args.rpc && args.pool) {
  await runLive();
} else if (args.scenarios) {
  await runScenarios();
} else {
  console.log(`
  Usage:
    --rpc <url> --pool <address>   run against a real pool
        [--reference <price>]     defaults to pool spot
        [--inventory <units>]     stock held, default 1000
        [--basis <price>]         average cost, default 0
        [--closed]                treat the primary session as closed

    --scenarios                   run constructed scenarios (no chain needed)
`);
}
