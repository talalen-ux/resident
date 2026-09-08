import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ALLOCATION,
  bestMove,
  evaluateMove,
} from "../src/lib/sim/allocate.ts";
import {
  DEFAULT_SIZING,
  binHalfWidth,
  binIdForPrice,
  binPrice,
  binWeights,
  bestConfiguration,
  evaluateDlmm,
  sizeForMarketCap,
} from "../src/lib/sim/dlmm.ts";

// --- DLMM bin maths ---------------------------------------------------------

test("bin prices step by the bin step, compounding", () => {
  // 100 bps = 1% between neighbouring bins.
  assert.equal(binPrice(0, 100), 1);
  assert.ok(Math.abs(binPrice(1, 100) - 1.01) < 1e-12);
  assert.ok(Math.abs(binPrice(2, 100) - 1.0201) < 1e-12);
  // 25 bps pools step a quarter as fast.
  assert.ok(Math.abs(binPrice(1, 25) - 1.0025) < 1e-12);
});

test("a price maps back to the bin it sits in", () => {
  for (const step of [1, 10, 25, 100]) {
    for (const id of [-50, -7, 0, 13, 200]) {
      assert.equal(binIdForPrice(binPrice(id, step), step), id);
    }
  }
});

test("width comes from how many bins the position spans", () => {
  // One bin has no width at all: it is a single price.
  assert.equal(binHalfWidth(1, 100), 0);
  // 21 bins at 1% each is 10 bins either side, ~10.46% compounded.
  assert.ok(Math.abs(binHalfWidth(21, 100) - 0.10462) < 1e-4);
});

const BASE = {
  volume: 20_000, feeBps: 100, binStep: 25, deployed: 10_000,
  liquidityPerBin: 5_000, volatility: 0.002, captureEfficiency: 1,
};

/**
 * The property that separates DLMM from v3: only the active bin earns, so
 * widening divides the stake in whichever bin is working.
 *
 * Note what this does NOT say. Tighter is not simply better — at 3 bins of 25
 * bps the position is in range under 10% of the time and earns almost nothing
 * despite holding 40% of the bin. Fee income peaks somewhere in the middle,
 * which is exactly why bestConfiguration searches for the width instead of
 * assuming one.
 */
test("widening divides the earning stake", () => {
  const shares = [3, 15, 41].map(
    (binCount) => evaluateDlmm({ ...BASE, binCount, shape: "spot" }).effectiveShare,
  );
  assert.ok(shares[0] > shares[1] && shares[1] > shares[2], shares.join(" > "));
});

test("fee income has an interior optimum, so width is searched not assumed", () => {
  const rates = [3, 15, 41].map(
    (binCount) => evaluateDlmm({ ...BASE, binCount, shape: "spot" }).feeRate,
  );
  // Neither edge wins: too narrow is out of range, too wide holds too little
  // of the bin that pays.
  assert.ok(rates[1] > rates[0], "15 bins beats 3");
  assert.ok(rates[1] > rates[2], "15 bins beats 41");
});

test("shapes put their weight where they say they do", () => {
  const spot = binWeights("spot", 5);
  assert.ok(spot.every((w) => Math.abs(w - 0.2) < 1e-12), "spot is even");

  const curve = binWeights("curve", 5);
  assert.ok(curve[2] > curve[0] && curve[2] > curve[4], "curve peaks in the middle");

  const bidask = binWeights("bid-ask", 5);
  assert.ok(bidask[0] > bidask[2] && bidask[4] > bidask[2], "bid-ask is thin in the middle");

  for (const w of [spot, curve, bidask]) {
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12, "weights normalise");
  }
});

/**
 * The TESTIBULL lesson, as a property. Bid-ask puts the least stake in the
 * middle bins, which is exactly where a ranging price spends its time — so
 * while price sits mid-range, spot has more in the earning bin and out-earns
 * it. Bid-ask only wins when the price actually lives at the edges.
 */
test("spot out-earns bid-ask while the price sits mid-range", () => {
  const spot = evaluateDlmm({ ...BASE, binCount: 15, shape: "spot" });
  const bidask = evaluateDlmm({ ...BASE, binCount: 15, shape: "bid-ask" });
  assert.ok(
    spot.feeRate > bidask.feeRate,
    `spot ${spot.feeRate} should beat bid-ask ${bidask.feeRate} in the middle`,
  );
});

test("curve beats spot on a coin that barely moves", () => {
  const calm = { ...BASE, volatility: 0.0005, binCount: 15 };
  const curve = evaluateDlmm({ ...calm, shape: "curve" });
  const spot = evaluateDlmm({ ...calm, shape: "spot" });
  // All the time is spent in the middle bins, so weighting there collects more.
  assert.ok(curve.feeRate > spot.feeRate);
});

/**
 * The rug-pump case: a coin that can move violently. Narrow means the price
 * leaves and the position stops earning entirely; wide keeps something working.
 */
test("wide beats narrow when the coin can move violently", () => {
  const violent = { ...BASE, volatility: 0.05, feeBps: 200, volume: 200_000 };
  const narrow = evaluateDlmm({ ...violent, binCount: 3, shape: "spot" });
  const wide = evaluateDlmm({ ...violent, binCount: 69, shape: "spot" });
  assert.ok(wide.netRate > narrow.netRate,
    `wide ${wide.netRate} should beat narrow ${narrow.netRate} on a violent coin`);
});

test("lower market cap sizes smaller and goes wider", () => {
  const big = sizeForMarketCap(50_000_000);
  const mid = sizeForMarketCap(10_000_000);
  const small = sizeForMarketCap(250_000);

  assert.ok(big.capital >= mid.capital && mid.capital > small.capital,
    "size falls with market cap");
  assert.ok(small.binCount > mid.binCount && mid.binCount >= big.binCount,
    "width grows as market cap falls");
  assert.ok(small.capital >= DEFAULT_SIZING.minCapital, "never below the floor");
  assert.ok(small.binCount <= DEFAULT_SIZING.maxBinCount, "never past the cap");
});

test("a violent pair is rejected however big the fee number is", () => {
  const verdict = evaluateDlmm({
    volume: 500_000,
    feeBps: 200,
    binStep: 100,
    binCount: 5,
    shape: "spot",
    deployed: 10_000,
    liquidityPerBin: 2_000,
    volatility: 0.09, // 9% a minute
    captureEfficiency: 1,
  });
  assert.ok(verdict.bleedRate > verdict.feeRate, verdict.reason);
  assert.ok(verdict.netRate < 0);
});

test("width and shape are both searched, not assumed", () => {
  const { binCount, shape, verdict } = bestConfiguration({
    volume: 20_000, feeBps: 100, binStep: 25, deployed: 10_000,
    liquidityPerBin: 5_000, volatility: 0.004, captureEfficiency: 1,
  });
  assert.ok(binCount >= 1);
  assert.ok(["spot", "curve", "bid-ask"].includes(shape));
  assert.ok(Number.isFinite(verdict.netRate));
});

// --- Cross-chain allocation -------------------------------------------------

const HOME = { name: "AMC/USDG", chain: "robinhood", netRate: 0.00002 };
const BRIDGE = { feeFraction: 0.0025, fixedCost: 4, latencyIntervals: 2 };

test("a small edge does not pay for the round trip", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.000021 };
  const v = evaluateMove(HOME, away, 10_000, BRIDGE);
  assert.equal(v.move, false);
  assert.match(v.reason, /round trip/);
});

test("a large, durable edge does", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.0002 };
  const v = evaluateMove(HOME, away, 10_000, BRIDGE);
  assert.equal(v.move, true, v.reason);
  assert.ok(v.netGain > 0);
});

test("both bridge legs are charged, not just the outbound one", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.0002 };
  const v = evaluateMove(HOME, away, 10_000, BRIDGE);
  // 25bps on 10k is $25 a leg, plus $4 fixed: $58 for the round trip.
  assert.ok(Math.abs(v.bridgeCost - 58) < 1e-9, `bridgeCost ${v.bridgeCost}`);
});

test("time in transit is charged at the rate being given up", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.0002 };
  const v = evaluateMove(HOME, away, 10_000, BRIDGE);
  // 10k x 0.00002 x 2 intervals x 2 legs.
  assert.ok(Math.abs(v.idleCost - 0.8) < 1e-9, `idleCost ${v.idleCost}`);
});

test("a shorter assumed edge life makes the same move unattractive", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.0002 };
  const patient = evaluateMove(HOME, away, 10_000, BRIDGE, DEFAULT_ALLOCATION);
  const hasty = evaluateMove(HOME, away, 10_000, BRIDGE, {
    ...DEFAULT_ALLOCATION,
    edgeHalfLife: 20,
  });
  assert.equal(patient.move, true);
  assert.equal(hasty.move, false, hasty.reason);
});

test("a worse venue is never chosen", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.000005 };
  assert.equal(evaluateMove(HOME, away, 10_000, BRIDGE).move, false);
});

test("dust stays put whatever the edge", () => {
  const away = { name: "SOL pool", chain: "solana", netRate: 0.01 };
  const v = evaluateMove(HOME, away, 100, BRIDGE);
  assert.equal(v.move, false);
  assert.match(v.reason, /floor/);
});

test("a same-chain switch pays no bridge and no transit", () => {
  const local = { name: "BBBY/USDG", chain: "robinhood", netRate: 0.00004 };
  const best = bestMove(HOME, [local], 10_000, {}, DEFAULT_ALLOCATION);
  assert.ok(best, "a free local switch with a real edge should be taken");
  assert.equal(best.bridgeCost, 0);
  assert.equal(best.idleCost, 0);
});

test("the best available move wins, and none is a valid answer", () => {
  const bridges = { solana: BRIDGE };
  const good = { name: "SOL A", chain: "solana", netRate: 0.0002 };
  const better = { name: "SOL B", chain: "solana", netRate: 0.0009 };
  const best = bestMove(HOME, [good, better], 10_000, bridges);
  assert.equal(best?.to.name, "SOL B");

  const nothing = bestMove(HOME, [{ name: "SOL C", chain: "solana", netRate: 0.000001 }], 10_000, bridges);
  assert.equal(nothing, null);
});

test("a chain with no configured bridge is not considered", () => {
  const best = bestMove(
    HOME,
    [{ name: "far", chain: "some-l2", netRate: 9 }],
    10_000,
    { solana: BRIDGE },
  );
  assert.equal(best, null, "no bridge means no route, however good the rate");
});
