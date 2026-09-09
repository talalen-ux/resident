/**
 * Run the keeper.
 *
 *   RESIDENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
 *     node --experimental-strip-types scripts/keeper.mjs
 *
 * Dry run by default, and there is no flag in this repository that makes it
 * anything else. Going live needs two things that are deliberately not here: a
 * signer (see src/lib/keeper/signer.ts — a KMS or HSM, never a key in a file)
 * and a venue executor that knows how to open a position on the venue you are
 * pointing it at. Until both exist the loop reads chains, ranks pools, and
 * writes down what it would have done.
 *
 * That journal is worth having on its own. Left running for a week it says
 * which positions the desk would have opened and when it would have moved
 * them, and those can be checked against what the pools actually paid before
 * any money is at risk.
 *
 *   --once             one interval, then exit
 *   --interval=60      seconds between ticks (default 60)
 *   --journal=PATH     where to append (default .keeper/dry-run.ndjson)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { FileJournal } from "../src/lib/keeper/journal-file.ts";
import { DryRunSigner } from "../src/lib/keeper/signer.ts";
import { dryRunExecutor } from "../src/lib/keeper/executor-dryrun.ts";
import { DEFAULT_TICK, tick } from "../src/lib/keeper/loop.ts";
import { loadState } from "../src/lib/keeper/registry.ts";
import { ledgerFrom, ledgerTotals } from "../src/lib/keeper/ledger.ts";
import { RpcPoolsSource, discoverPools } from "../src/lib/desk/rpc-pools-source.ts";
import { realisedVolatility } from "../src/lib/sim/strategy.ts";
import { liquidityInBand } from "../src/lib/sim/opportunity.ts";

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const RPC = process.env.RESIDENT_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
if (!RPC) {
  console.error(
    "Set RESIDENT_RPC_URL to an RPC that can serve eth_getLogs.\n" +
      "The keeper reads volume, pool age and price history from Swap and " +
      "Initialize logs; there is nothing useful it can do without one.",
  );
  process.exit(1);
}

const journalPath = arg("journal", ".keeper/dry-run.ndjson");
const intervalSeconds = Number(arg("interval", "60"));
const once = process.argv.includes("--once");

const CACHE = ".pools.json";
let watched;
if (existsSync(CACHE)) {
  watched = JSON.parse(readFileSync(CACHE, "utf8"));
} else {
  process.stdout.write("  scanning Initialize logs… ");
  watched = await discoverPools(RPC);
  writeFileSync(CACHE, JSON.stringify(watched, null, 2));
  console.log(`found ${watched.length} pools`);
}

const source = new RpcPoolsSource(RPC, watched);
const journal = new FileJournal(journalPath);
const signer = new DryRunSigner();
const execute = dryRunExecutor();

/**
 * Turn live pool observations into the board the scanner ranks.
 *
 * Volatility comes from the sampled price track rather than a constant: the
 * scanner refuses a pool without it, so a pool whose history is too short to
 * measure is skipped and reported rather than priced as calm.
 */
function toScannedPools(observations) {
  const pools = [];
  for (const obs of observations) {
    const prices = obs.prices ?? [];
    if (prices.length < 20) continue;
    const volatility = realisedVolatility(prices);
    if (!(volatility > 0)) continue;

    // Both figures are in whatever the pool is quoted in, and the sizing and
    // allocation rules below are in dollars. A pool whose quote could not be
    // priced is skipped rather than converted at a made-up rate.
    const usd = obs.quoteUsd;
    if (!(usd > 0)) continue;

    pools.push({
      name: `${obs.pool.token0.symbol}/${obs.pool.token1.symbol}`,
      chain: "robinhood",
      kind: "band",
      volume: (obs.volume.h1 / 60) * usd,
      volatility,
      liquidity: liquidityInBand(obs.pool, 0.05) * usd,
      feePips: obs.pool.fee,
      prices,
    });
  }
  return pools;
}

const deps = {
  signer,
  execute,
  // Nothing was ever signed, so nothing can be in flight. A live executor
  // replaces this with a lookup against the venue.
  reconcile: async () => ({ found: null }),
  observe: async () => {
    const observations = await source.observe();
    return {
      pools: toScannedPools(observations),
      positions: [],
      current: null,
      idleCapital: Number(process.env.RESIDENT_DRY_CAPITAL ?? 0),
      unbookedProfit: 0,
      unbookedLoss: 0,
      owed: 0,
      bridges: {},
      vault: { owner: "0x", keeper: "0x" },
    };
  },
};

console.log(`  journal   ${journalPath}`);
console.log(`  signer    ${signer.description}`);
console.log(`  interval  ${intervalSeconds}s${once ? " (once)" : ""}`);
console.log("");

async function runOnce() {
  const report = await tick(deps, journal, DEFAULT_TICK);
  const when = new Date(report.at).toISOString().slice(11, 19);

  if (report.halted) {
    console.log(`${when}  halted: ${report.halted}`);
    return;
  }

  const ranked = report.scan?.ranked ?? [];
  const eligible = ranked.filter((r) => r.eligible);
  console.log(
    `${when}  ${ranked.length} pools, ${eligible.length} eligible, ` +
      `${report.intents.length} intents`,
  );
  for (const r of eligible.slice(0, 5)) {
    console.log(
      `          ${r.pool.name.padEnd(16)} ${(r.netApr * 100).toFixed(1)}% APR  ${r.reason}`,
    );
  }
  for (const result of report.results) {
    console.log(
      `          ${result.ok ? "→" : "×"} ${result.intent.kind}: ${result.intent.reason}`,
    );
  }
  if (report.scan?.skipped.length) {
    console.log(`          ${report.scan.skipped.length} skipped (unpriceable)`);
  }
}

await runOnce();

if (!once) {
  const timer = setInterval(runOnce, intervalSeconds * 1000);
  process.on("SIGINT", async () => {
    clearInterval(timer);
    const state = await loadState(journal);
    const totals = ledgerTotals(ledgerFrom(await journal.read()));
    console.log(
      `\n  ${state.positions.length} positions, ${totals.closed} closed, ` +
        `${totals.feesSwept.toFixed(2)} in fees — all of it hypothetical.`,
    );
    process.exit(0);
  });
}
