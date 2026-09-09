import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SCAN, pricePool, scan } from "../src/lib/sim/scanner.ts";

/** A price that keeps coming back: the only kind worth providing liquidity to. */
const RANGING = [100, 104, 97, 102, 96, 101, 99, 103, 98, 100, 102, 99];
/** The same length of history, going one way. */
const TRENDING = [100, 92, 84, 77, 70, 64, 58, 52, 47, 42, 38, 34];

const BAND = {
  name: "AMC/USDG", chain: "robinhood", kind: "band",
  volume: 500, volatility: 0.003, liquidity: 120_000, feePips: 3000,
  prices: RANGING,
};
const DLMM = {
  name: "CATE/SOL", chain: "solana", kind: "dlmm",
  volume: 800, volatility: 0.006, binStep: 25, feeBps: 100,
  liquidityPerBin: 4_000, prices: RANGING,
};
const BRIDGE = { feeFraction: 0.0025, fixedCost: 4, latencyIntervals: 2 };

/**
 * The failure this guards against is silent and it is the worst one: a pool
 * with no volatility has no modelled cost of holding, so it prices as pure fee
 * income and sorts to the TOP. The least-understood pool would look like the
 * best one.
 */
test("a pool with no volatility is refused, not priced as calm", () => {
  assert.throws(() => pricePool({ ...BAND, volatility: 0 }), /volatility is required/);
  assert.throws(() => pricePool({ ...DLMM, volatility: undefined }), /volatility is required/);
});

test("a refused pool is reported, never silently dropped", () => {
  const result = scan([BAND, { ...DLMM, volatility: 0 }], null, 10_000, {});
  assert.equal(result.ranked.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /volatility/);
});

test("both venue types price into the same comparable number", () => {
  const band = pricePool(BAND);
  const dlmm = pricePool(DLMM);
  for (const r of [band, dlmm]) {
    assert.ok(Number.isFinite(r.netRate), `${r.pool.name} netRate`);
    assert.ok(Number.isFinite(r.netApr));
  }
  // The DLMM side also reports the width and shape the search chose.
  assert.ok(dlmm.binCount >= 1);
  assert.ok(["spot", "curve", "bid-ask"].includes(dlmm.shape));
  assert.equal(band.binCount, undefined);
});

test("the board ranks by net rate, across chains", () => {
  const { ranked } = scan([BAND, DLMM], null, 10_000, { solana: BRIDGE });
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].netRate >= ranked[1].netRate);
});

test("ranking first is not the same as being worth the crossing", () => {
  // A Solana pool barely ahead of where the capital already sits.
  const here = { name: "AMC/USDG", chain: "robinhood", netRate: 0.00002 };
  const marginal = { ...DLMM, name: "marginal", volume: 1, volatility: 0.003 };
  const { move } = scan([BAND, marginal], here, 10_000, { solana: BRIDGE });
  // Either no move, or one that cleared the round-trip margin — never a move
  // justified by rank alone.
  if (move) assert.ok(move.margin >= DEFAULT_SCAN.allocation.requiredMargin);
});

test("a clear edge across the bridge is taken", () => {
  const here = { name: "AMC/USDG", chain: "robinhood", netRate: 0.000001 };
  const rich = { ...DLMM, name: "rich", volume: 40_000, feeBps: 200, volatility: 0.002 };
  const { move } = scan([rich], here, 20_000, { solana: BRIDGE });
  assert.ok(move, "a large durable edge should cross");
  assert.equal(move.to.chain, "solana");
});

test("sizing shrinks with market cap, and the board reports what it would commit", () => {
  const big = pricePool({ ...DLMM, marketCap: 50_000_000 });
  const small = pricePool({ ...DLMM, marketCap: 300_000 });
  assert.ok(big.capital > small.capital, `${big.capital} vs ${small.capital}`);
});

test("with nowhere to move from, the scan still ranks", () => {
  const { ranked, move } = scan([BAND, DLMM], null, 10_000, {});
  assert.equal(ranked.length, 2);
  assert.equal(move, null);
});

/**
 * The gate that stops the board recommending a collapse.
 *
 * Volume is enormous on the way down, so fee rate alone ranks a token mid-fall
 * at the top. Every one of these assertions is about the board REFUSING a pool
 * it has just ranked highly.
 */
test("a trending pool is ranked but never opened into", () => {
  const falling = { ...DLMM, name: "falling", prices: TRENDING };
  const result = pricePool(falling);
  assert.equal(result.eligible, false);
  assert.match(result.blockedBy, /trending/);
  assert.equal(result.ranging.ranging, false);
});

test("no price history is not a pass", () => {
  const unknown = { ...DLMM, name: "unknown", prices: undefined };
  const result = pricePool(unknown);
  assert.equal(result.eligible, false);
  assert.equal(result.ranging, null);
  assert.match(result.blockedBy, /no price history/);
});

test("capital is never moved into a pool that has not been shown to range", () => {
  const here = { name: "AMC/USDG", chain: "robinhood", netRate: 0.000001 };
  const rich = {
    ...DLMM, name: "rich", volume: 40_000, feeBps: 200, volatility: 0.002,
    prices: TRENDING,
  };
  const { ranked, move } = scan([rich], here, 20_000, { solana: BRIDGE });
  // It still tops the board on rate — that is the point of the ranking staying
  // honest — and it is still not where the capital goes.
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].netRate > here.netRate);
  assert.equal(move, null);
});

test("the ranging gate can be switched off, and says so in the config", () => {
  const off = { ...DEFAULT_SCAN, requireRanging: false };
  const result = pricePool({ ...DLMM, prices: undefined }, off);
  assert.equal(result.eligible, true);
  assert.equal(result.blockedBy, null);
});

/**
 * Quote-only is a stance on the token, not something the search may discover.
 * A search free to pick either side straddles whenever straddling scores
 * better, which on a token we refuse to hold is exactly the wrong answer.
 */
test("a quote-only pool is only ever laddered below the price", () => {
  const laddered = pricePool({ ...DLMM, quoteOnly: true });
  assert.equal(laddered.side, "quote");
  const straddled = pricePool(DLMM);
  assert.equal(straddled.side, "both");
});

test("holding no token below the price costs fees and saves bleed", () => {
  const calm = { ...DLMM, volatility: 0.0004 };
  const straddle = pricePool(calm);
  const ladder = pricePool({ ...calm, quoteOnly: true });
  assert.ok(ladder.netRate < straddle.netRate, "the ladder gives up fees");
  assert.ok(ladder.netRate > 0, "and is still worth doing on a calm pair");
});

/** Re-centring a position we already hold beats anything needing a bridge. */
test("open positions are reviewed against a fresh position on the same pool", async () => {
  const { reviewPositions } = await import("../src/lib/sim/scanner.ts");
  // A pool that actually pays, so "a fresh position would earn more" is a
  // statement about drift rather than about the pool being a loser either way.
  const busy = { ...BAND, volume: 60_000 };
  const { ranked } = scan([busy], null, 10_000, {});
  assert.ok(ranked[0].netRate > 0, "fixture must be worth holding at all");
  const drifted = {
    name: "AMC/USDG", capital: 10_000,
    currentRate: ranked[0].netRate / 10,
    feesUnclaimed: 40, ageIntervals: 500,
  };
  const [reviewed] = reviewPositions([drifted], ranked, { gas: 5, slippageFraction: 0.001 });
  assert.equal(reviewed.verdict.rebalance, true);
  assert.ok(reviewed.verdict.decay > 0.8);
});

test("a position whose pool left the board gets no verdict rather than a guess", async () => {
  const { reviewPositions } = await import("../src/lib/sim/scanner.ts");
  const { ranked } = scan([DLMM], null, 10_000, {});
  const orphan = {
    name: "gone", capital: 10_000, currentRate: 0, feesUnclaimed: 0, ageIntervals: 900,
  };
  const [reviewed] = reviewPositions([orphan], ranked, { gas: 5, slippageFraction: 0.001 });
  assert.equal(reviewed.verdict, null);
});
