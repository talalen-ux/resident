import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ALLOCATION,
  bestMove,
  evaluateMove,
} from "../src/lib/sim/allocate.ts";
import {
  binHalfWidth,
  binIdForPrice,
  binPrice,
  bestBinCount,
  evaluateDlmm,
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

/**
 * The property that separates DLMM from v3. In v3, spreading the same capital
 * wider keeps all of it earning while price is in range. Here only the active
 * bin pays, so widening divides the earning stake — the fee rate must fall
 * faster than the extra time in range can make up, at low volatility.
 */
test("widening a DLMM position cuts the fee rate, because only one bin earns", () => {
  const base = {
    volume: 20_000,
    feeBps: 100,
    binStep: 25,
    deployed: 10_000,
    liquidityPerBin: 5_000,
    volatility: 0.002,
    captureEfficiency: 1,
  };
  const tight = evaluateDlmm({ ...base, binCount: 3 });
  const wide = evaluateDlmm({ ...base, binCount: 41 });

  assert.ok(tight.activeBinShare > wide.activeBinShare,
    `share ${tight.activeBinShare} vs ${wide.activeBinShare}`);
  assert.ok(wide.timeInRange > tight.timeInRange, "wider should sit in range more often");
  assert.ok(tight.feeRate > wide.feeRate,
    `tight ${tight.feeRate} should out-earn wide ${wide.feeRate}`);
});

test("a violent pair is rejected however big the fee number is", () => {
  const verdict = evaluateDlmm({
    volume: 500_000,
    feeBps: 200,
    binStep: 100,
    binCount: 5,
    deployed: 10_000,
    liquidityPerBin: 2_000,
    volatility: 0.09, // 9% a minute
    captureEfficiency: 1,
  });
  assert.ok(verdict.bleedRate > verdict.feeRate, verdict.reason);
  assert.ok(verdict.netRate < 0);
});

test("the best bin count is searched, not assumed", () => {
  const { binCount, verdict } = bestBinCount({
    volume: 20_000, feeBps: 100, binStep: 25, deployed: 10_000,
    liquidityPerBin: 5_000, volatility: 0.004, captureEfficiency: 1,
  });
  assert.ok(binCount >= 1);
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
