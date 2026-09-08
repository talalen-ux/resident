import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SCAN, pricePool, scan } from "../src/lib/sim/scanner.ts";

const BAND = {
  name: "AMC/USDG", chain: "robinhood", kind: "band",
  volume: 500, volatility: 0.003, liquidity: 120_000, feePips: 3000,
};
const DLMM = {
  name: "CATE/SOL", chain: "solana", kind: "dlmm",
  volume: 800, volatility: 0.006, binStep: 25, feeBps: 100,
  liquidityPerBin: 4_000,
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
