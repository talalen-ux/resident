/**
 * Screen DexScreener pairs through the desk's own entry test.
 *
 * A screener ranks by fee income. That is the ranking this strategy exists to
 * argue with: a pool paying 3% a day into a book that moves 20% a day loses
 * money, and a fee ranking recommends it every time. So this pulls the pairs
 * and then runs evaluateEntry over them, sorting by NET — fees less the
 * expected cost of price movement — and showing the fee-ranked position beside
 * it so the disagreement is visible.
 *
 *   node --experimental-strip-types scripts/screen.mjs
 *   node --experimental-strip-types scripts/screen.mjs --chain solana --min-vol 50000
 *
 * WHAT THIS IS NOT
 *
 * DexScreener reports a pool's TOTAL liquidity. The strategy needs the
 * liquidity sitting within ±5% of the price, which in a concentrated-liquidity
 * pool is a different and usually much smaller number. Using total liquidity
 * understates our share and therefore understates the fee rate. Volatility is
 * likewise inferred from the 5m/1h/6h price changes rather than measured from a
 * price series.
 *
 * Both approximations are named in the output. This produces a SHORTLIST worth
 * reading on-chain, not a decision. Confirm a candidate against real pool state
 * — liquidityInBand in src/lib/sim/opportunity.ts — before committing capital.
 */

import {
  DEFAULT_ENTRY_CONFIG,
  evaluateEntry,
} from "../src/lib/sim/strategy.ts";

const API = "https://api.dexscreener.com";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const CHAIN = arg("chain", "robinhood");
const MIN_VOL_H1 = Number(arg("min-vol", 25_000));
const MAX_LIQ = Number(arg("max-liq", 400_000));
const BAND = Number(arg("band", 10_000));
const QUERY = arg("q", "");

/** DexScreener puts the fee tier in labels on some dexes ("0.3%"), not all. */
function feePips(pair) {
  for (const label of pair.labels ?? []) {
    const m = /^([\d.]+)%$/.exec(String(label).trim());
    if (m) return Math.round(Number(m[1]) * 10_000);
  }
  return null;
}

/**
 * Volatility per minute, inferred from the price changes DexScreener reports.
 *
 * A percentage move over a window is not a standard deviation. Treating |move|
 * over the window as roughly one sigma and scaling by √minutes is crude, and it
 * is the weakest number here — it is used because the alternative is a price
 * series this endpoint does not provide.
 */
function volatilityPerMinute(pair) {
  const windows = [
    [Math.abs(pair.priceChange?.m5 ?? 0) / 100, 5],
    [Math.abs(pair.priceChange?.h1 ?? 0) / 100, 60],
    [Math.abs(pair.priceChange?.h6 ?? 0) / 100, 360],
  ].filter(([move]) => move > 0);
  if (!windows.length) return 0;
  const perMin = windows.map(([move, mins]) => move / Math.sqrt(mins));
  return perMin.reduce((a, b) => a + b, 0) / perMin.length;
}

const usd = (n) =>
  n >= 1_000_000
    ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}k`
      : `$${Math.round(n)}`;

async function fetchPairs() {
  const res = await fetch(
    `${API}/latest/dex/search?q=${encodeURIComponent(QUERY || CHAIN)}`,
  );
  if (!res.ok) throw new Error(`DexScreener returned ${res.status}`);
  const { pairs = [] } = await res.json();
  return CHAIN ? pairs.filter((p) => p.chainId === CHAIN) : pairs;
}

const rows = [];
const pairs = await fetchPairs();

for (const pair of pairs) {
  const volH1 = pair.volume?.h1 ?? 0;
  const liquidity = pair.liquidity?.usd ?? 0;
  const fee = feePips(pair);
  const vol = volatilityPerMinute(pair);
  const ageMinutes = pair.pairCreatedAt
    ? (Date.now() - pair.pairCreatedAt) / 60_000
    : Infinity;

  // The gates that DexScreener can actually answer. The two it cannot — no v4
  // hook, and liquidity providers currently winning — are left to the on-chain
  // check, and named in the footer rather than silently skipped.
  const reasons = [];
  if (volH1 < MIN_VOL_H1) reasons.push(`volume ${usd(volH1)}/h`);
  if (!liquidity || liquidity > MAX_LIQ) reasons.push(`liquidity ${usd(liquidity)}`);
  if (ageMinutes < 20) reasons.push(`${Math.round(ageMinutes)}m old`);
  if (fee === null) reasons.push("fee tier not reported");
  if (vol <= 0) reasons.push("no price movement reported");
  if (reasons.length) continue;

  const verdict = evaluateEntry(
    {
      volume: volH1 / 60, // the model is per-minute; this is an hourly figure
      liquidity,
      feePips: fee,
      volatility: vol,
      deployed: BAND,
      captureEfficiency: 1, // an upper bound, never a fitted value
    },
    DEFAULT_ENTRY_CONFIG,
  );

  rows.push({
    pair: `${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}`,
    url: pair.url,
    liquidity,
    volH1,
    feePct: fee / 10_000,
    volPct: vol * 100,
    ...verdict,
    // What a fee-ranked board would show: gross income, no cost of movement.
    grossRate: verdict.feeRate,
  });
}

if (!rows.length) {
  console.log(`No pairs on "${CHAIN}" cleared the screenable gates.`);
  console.log(`Tried ${pairs.length} pairs. Loosen with --min-vol / --max-liq.`);
  process.exit(0);
}

const byNet = [...rows].sort((a, b) => b.netApr - a.netApr);
const byFee = [...rows].sort((a, b) => b.grossRate - a.grossRate);
const feeRank = new Map(byFee.map((r, i) => [r.pair, i + 1]));

console.log(`\n  ${byNet.length} candidates on ${CHAIN}, a $${BAND.toLocaleString("en-US")} band\n`);
console.log(
  "  " +
    ["PAIR".padEnd(18), "NET RATE".padStart(10), "FEE RATE".padStart(10),
     "WIDTH".padStart(8), "LIQ".padStart(9), "VOL/H".padStart(9),
     "FEE-RANK".padStart(9), "  VERDICT"].join(""),
);
console.log("  " + "─".repeat(96));

for (const r of byNet.slice(0, 25)) {
  const grossApr = r.grossRate * DEFAULT_ENTRY_CONFIG.intervalsPerYear;
  console.log(
    "  " +
      r.pair.slice(0, 17).padEnd(18) +
      `${(r.netApr * 100).toFixed(0)}%`.padStart(10) +
      `${(grossApr * 100).toFixed(0)}%`.padStart(10) +
      `±${(r.halfWidth * 100).toFixed(1)}%`.padStart(8) +
      usd(r.liquidity).padStart(9) +
      usd(r.volH1).padStart(9) +
      `#${feeRank.get(r.pair)}`.padStart(9) +
      (r.enter ? "  open" : "  skip"),
  );
}

const disagreements = byNet
  .slice(0, 10)
  .filter((r) => !r.enter || feeRank.get(r.pair) > 10);
console.log(
  `\n  ${byNet.filter((r) => r.enter).length} of ${byNet.length} pass the net test.`,
);
if (disagreements.length) {
  console.log(
    `  ${disagreements.length} of the top 10 by net are not where a fee ranking would put them.`,
  );
}

console.log(`
  Rates are the trailing hour annualised — a comparison between pools at this
  moment, not a forecast of a year. Read this as a shortlist, not a decision:
    · liquidity is the pool total, not the depth within ±5% of price, so our
      share — and the fee rate — is understated
    · volatility is inferred from reported price changes, not measured
    · two gates cannot be checked here: no v4 hook taking the fee, and
      liquidity providers currently net winning in the pool
    · capture efficiency is 1, which is a ceiling and not a forecast
  Confirm a candidate against real pool state before committing capital.
`);
