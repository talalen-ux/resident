#!/usr/bin/env node
/**
 * Which strategy actually wins: dislocation harvesting, or fee capture?
 *
 *   # against real history, once an indexer exists
 *   node --experimental-strip-types scripts/backtest.mjs --indexer <url> --days 30
 *
 *   # against generated series, to exercise the engine with no data
 *   node --experimental-strip-types scripts/backtest.mjs --synthetic
 *
 * Both paths run identical strategy code. Only the history source differs, and
 * the output states which produced the numbers.
 */

import {
  DEFAULT_BAND_CONFIG,
  DEFAULT_DISLOCATION_CONFIG,
  compare,
} from "../src/lib/sim/backtest.ts";
import { SyntheticHistorySource } from "../src/lib/sim/history.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") ? true : (all[i + 1] ?? true)]] : [],
  ),
);

const money = (n) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

const MINUTE = 60_000;

/**
 * Generated scenarios spanning the range of plausible regimes.
 *
 * These are NOT real pools — each one's properties are set by construction. But
 * the volume and liquidity figures are calibrated to positions running live on
 * Robinhood Chain, so the regimes are at least the right order of magnitude:
 *
 *   CHURN/USDG   $1.25M/h flow, ~$70k in-band liquidity, 2% fee
 *   THIN/USDG    $10.6k/h flow, ~$620 in-band liquidity, 5% fee
 *
 * baseVolume is PER INTERVAL, and intervals are minutes — an hourly figure
 * dropped in here directly overstates flow sixtyfold.
 */
const SCENARIOS = {
  "quiet-equity": {
    pair: "AAPL/USDG", feePips: 500, startPrice: 240, vol: 0.0008,
    spikeProb: 0.0002, spikeSize: 0.3, spikeDecay: 6,
    baseVolume: 500, baseLiquidity: 900_000, // $30k/h
    intervals: 43_200, intervalMs: MINUTE, seed: 1,
  },
  "thin-equity": {
    pair: "AAOI/USDG", feePips: 3000, startPrice: 18, vol: 0.004,
    spikeProb: 0.0015, spikeSize: 0.45, spikeDecay: 20,
    baseVolume: 70, baseLiquidity: 40_000, // $4.2k/h
    intervals: 43_200, intervalMs: MINUTE, seed: 2,
  },
  "memecoin-churn": {
    pair: "CHURN/USDG", feePips: 20000, startPrice: 0.0085, vol: 0.012,
    spikeProb: 0.0008, spikeSize: 0.25, spikeDecay: 4,
    baseVolume: 20_800, baseLiquidity: 70_000, // $1.25M/h, as observed
    intervals: 43_200, intervalMs: MINUTE, seed: 3,
  },
  "memecoin-dump": {
    pair: "THIN/USDG", feePips: 50000, startPrice: 0.00078, vol: 0.02,
    spikeProb: 0.0006, spikeSize: 0.3, spikeDecay: 5,
    baseVolume: 177, baseLiquidity: 620, // $10.6k/h, as observed
    intervals: 43_200, intervalMs: MINUTE, seed: 4,
  },
};

function report(c) {
  const b = c.band;
  const d = c.dislocation;

  console.log(`\n${"─".repeat(74)}`);
  console.log(`${c.pair}   ${c.days.toFixed(1)} days · ${c.intervals.toLocaleString()} intervals`);
  console.log("─".repeat(74));
  console.log(`  deviation      median ${pct(c.medianDeviation)}   max ${pct(c.maxDeviation)}`);
  console.log();
  console.log(`  ${pad("BAND (fee capture)", 34)}${pad("DISLOCATION (δ ≥ 25%)", 34)}`);
  console.log(
    `  ${pad(`fees        ${money(b.feesEarned)}`, 34)}` +
    `${pad(`episodes    ${d.episodes}`, 34)}`,
  );
  console.log(
    `  ${pad(`bleed      -${money(b.divergenceLoss)}`, 34)}` +
    `${pad(`orders      ${d.orders}`, 34)}`,
  );
  console.log(
    `  ${pad(`net         ${money(b.net)}  ${pct(b.netReturn)}`, 34)}` +
    `${pad(`profit      ${money(d.realisedProfit)}  ${pct(d.netReturn)}`, 34)}`,
  );
  console.log(
    `  ${pad(`in range    ${(b.timeInRange * 100).toFixed(0)}%`, 34)}` +
    `${pad(`longest     ${d.longestEpisode} intervals`, 34)}`,
  );
  console.log(
    `  ${pad(`rebalances  ${b.rebalances}${b.retired ? " · RETIRED" : ""}`, 34)}` +
    `${pad(`per event   ${d.orders ? money(d.realisedProfit / d.orders) : "—"}`, 34)}`,
  );
  console.log(`\n  winner: ${c.winner.toUpperCase()}`);
}

async function runSynthetic() {
  console.log("\n  SOURCE: generated series — these are not real pools.");
  console.log("  No indexer is configured, so each series is built from the parameters");
  console.log("  in scripts/backtest.mjs. They show what the engine concludes under");
  console.log("  known conditions, not what Robinhood Chain actually does.");
  console.log(
    `\n  Capital ${money(DEFAULT_BAND_CONFIG.capital)} each side · band ±${DEFAULT_BAND_CONFIG.halfWidth * 100}%` +
    ` · δ* ${pct(DEFAULT_DISLOCATION_CONFIG.minDeviation)}`,
  );

  const source = new SyntheticHistorySource(SCENARIOS);
  const results = [];
  for (const name of await source.list()) {
    const h = await source.load(name, Date.UTC(2026, 7, 1));
    const c = compare(h);
    report(c);
    results.push([name, c]);
  }

  console.log(`\n${"═".repeat(74)}`);
  console.log(`  ${pad("scenario", 18)}${rpad("band net", 14)}${rpad("dislocation", 14)}${rpad("winner", 16)}`);
  console.log("─".repeat(74));
  for (const [name, c] of results) {
    console.log(
      `  ${pad(name, 18)}${rpad(money(c.band.net), 14)}` +
      `${rpad(money(c.dislocation.realisedProfit), 14)}${rpad(c.winner, 16)}`,
    );
  }
  console.log("═".repeat(74) + "\n");
}

if (args.indexer) {
  console.error(
    "\n  The indexer adapter is not implemented — it needs the data source named in\n" +
    "  INTEGRATIONS.md (per-pool volume windows and LP event history). The engine\n" +
    "  and its interface are ready: supply a fetch function to IndexerHistorySource\n" +
    "  and this path runs unmodified.\n",
  );
  process.exit(2);
} else if (args.synthetic) {
  await runSynthetic();
} else {
  console.log(`
  Usage:
    --synthetic          run generated scenarios (no data needed)
    --indexer <url>      run against real pool history (needs the indexer)
`);
}
