/**
 * Validation for the swap engine.
 *
 * The engine cannot be checked against real pools in this environment, so it is
 * checked against things that are true independently of it: closed-form results
 * for a single-range swap, conservation and monotonicity properties, and the
 * behaviour the method relies on (a mirage quoting nothing, impact rising with
 * size, S* landing exactly on the floor).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  Q96,
  amount0Delta,
  amount1Delta,
  spotPrice,
  sqrtPriceAtTick,
  swapExactIn,
} from "../src/lib/sim/v3.ts";
import {
  DEFAULT_PARAMS,
  classify,
  deviation,
  evaluate,
  fillabilityProbe,
  impact,
  impactVsSpot,
  sizeLiquidation,
} from "../src/lib/sim/desk.ts";

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

/** A pool at price `price` with one wide, deep range. 18dp stock / 6dp quote. */
function pool({ price = 5, liquidity = 5_000_000n * 10n ** 12n, fee = 3000, ticks = [] } = {}) {
  // sqrt(price) adjusted for the 12-decimal gap between token0 and token1.
  const raw = price * 10 ** (6 - 18);
  const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96));
  return {
    sqrtPriceX96,
    liquidity,
    tick: Math.floor(Math.log(raw) / Math.log(1.0001)),
    fee,
    tickSpacing: 60,
    ticks,
    token0: { symbol: "AMC", decimals: 18 },
    token1: { symbol: "USDG", decimals: 6 },
  };
}

// --- the math, against closed form ----------------------------------------

test("spot price round-trips through the sqrt encoding", () => {
  for (const p of [0.5, 3.14, 5, 22.9, 180]) {
    close(spotPrice(pool({ price: p })), p, p * 1e-9, "spot price");
  }
});

test("amount deltas match the closed form L·Δ√P and L·Δ(1/√P)", () => {
  const L = 10n ** 20n;
  const a = sqrtPriceAtTick(-1000);
  const b = sqrtPriceAtTick(1000);

  // amount1 = L * (√b − √a) / 2^96
  assert.equal(amount1Delta(a, b, L), (L * (b - a)) / Q96);

  // amount0 = L * 2^96 * (√b − √a) / (√a·√b)
  const expected0 = ((L << 96n) * (b - a)) / b / a;
  assert.equal(amount0Delta(a, b, L), expected0);
});

test("a swap inside one range matches the closed-form price move", () => {
  const p = pool({ fee: 0 });
  const amountIn = 10n ** 18n; // 1 stock

  const res = swapExactIn(p, true, amountIn);

  // √P_next = L·√P / (L + Δx·√P/2^96)
  const expected =
    (p.liquidity * p.sqrtPriceX96) /
    (p.liquidity + (amountIn * p.sqrtPriceX96) / Q96);

  const drift = Number(res.sqrtPriceX96After - expected) / Number(expected);
  close(drift, 0, 1e-9, "post-swap sqrt price");
  assert.equal(res.exhausted, false);
});

test("output is bounded by the constant-product ideal and the fee", () => {
  const noFee = swapExactIn(pool({ fee: 0 }), true, 10n ** 18n);
  const withFee = swapExactIn(pool({ fee: 3000 }), true, 10n ** 18n);

  assert.ok(withFee.amountOut < noFee.amountOut, "the fee must cost the taker");
  const ratio = Number(withFee.amountOut) / Number(noFee.amountOut);
  close(ratio, 0.997, 5e-4, "0.3% fee should cost ~0.3% of output");
});

test("a round trip loses roughly twice the fee and never profits", () => {
  const p = pool({ fee: 3000 });
  const stockIn = 10n ** 18n;

  const out = swapExactIn(p, true, stockIn);
  const back = swapExactIn(
    { ...p, sqrtPriceX96: out.sqrtPriceX96After },
    false,
    out.amountOut,
  );

  assert.ok(back.amountOut < stockIn, "a round trip must never return more than it sent");
  const loss = 1 - Number(back.amountOut) / Number(stockIn);
  close(loss, 0.006, 2e-3, "round-trip loss ≈ 2 × 0.3%");
});

test("selling more always gets a worse effective price", () => {
  const p = pool();
  let previous = Infinity;
  for (const size of [1n, 10n, 100n, 1_000n, 10_000n]) {
    const res = swapExactIn(p, true, size * 10n ** 18n);
    const effective = Number(res.amountOut) / Number(size * 10n ** 18n);
    assert.ok(effective < previous, `effective price must fall as size rises (${size})`);
    previous = effective;
  }
});

test("a pool with no liquidity fills nothing", () => {
  const res = swapExactIn(pool({ liquidity: 0n }), true, 10n ** 18n);
  assert.equal(res.amountOut, 0n);
  assert.equal(res.exhausted, true);
});

test("a swap crosses ticks and picks up the liquidity behind them", () => {
  // Thin enough that a $-scale order walks well past the tick: 1,000 stock
  // moves this pool from 5.00 to about 4.05, roughly 2,100 ticks.
  const base = pool({ fee: 0, liquidity: 20_000n * 10n ** 12n });
  const below = base.tick - 600;
  // Crossing downward removes 95% of the liquidity.
  const cliff = {
    ...base,
    ticks: [{ index: below, liquidityNet: base.liquidity - base.liquidity / 20n }],
  };

  const size = 1_000n * 10n ** 18n;
  const flat = swapExactIn(base, true, size);
  const overCliff = swapExactIn(cliff, true, size);

  assert.equal(flat.ticksCrossed, 0, "the flat pool has no ticks to cross");
  assert.ok(overCliff.ticksCrossed >= 1, "the swap should have crossed the tick");
  assert.ok(
    overCliff.amountOut < flat.amountOut,
    "losing liquidity past a tick must produce a worse fill",
  );
});

// --- the desk's decisions --------------------------------------------------

test("deviation reads the dislocation off the pool", () => {
  close(deviation(pool({ price: 6.5 }), 5), 0.3, 1e-6, "+30% deviation");
  close(deviation(pool({ price: 4.5 }), 5), -0.1, 1e-6, "−10% deviation");
});

test("the probe passes on a real pump and fails on a mirage", () => {
  const reference = 5;

  const real = fillabilityProbe(pool({ price: 8 }), reference);
  assert.equal(real.filled, true);
  assert.ok(real.passed, `probe should clear φ_min, got $${real.yield.toFixed(2)}`);

  // Displayed price is spectacular; there is nothing behind it.
  const mirage = fillabilityProbe(pool({ price: 400, liquidity: 0n }), reference);
  assert.equal(mirage.filled, false);
  assert.equal(mirage.passed, false);
});

test("impact rises with notional and separates deep from eligible", () => {
  const deep = pool({ price: 5, liquidity: 5_000_000n * 10n ** 12n });
  const thin = pool({ price: 5, liquidity: 4_000n * 10n ** 12n });

  assert.ok(impact(deep, 5, 10_000) > impact(deep, 5, 1_000), "impact must rise with size");

  assert.equal(classify(deep, 5).classification, "deep");
  assert.equal(classify(thin, 5).classification, "eligible");
});

test("S* lands on the profit floor, and the tranche is τ of it", () => {
  const reference = 5;
  const p = pool({ price: 9, liquidity: 20_000n * 10n ** 12n });

  const s = sizeLiquidation(p, reference, 10_000, 4.5);
  assert.ok(s.qualifies, `expected a qualifying size: ${s.reason}`);

  // Selling exactly S* should land at the floor; selling more should breach it.
  const at = swapExactIn(p, true, BigInt(Math.floor(s.maxSize * 1e18)));
  const effectiveAtMax = Number(at.amountOut) / 1e6 / s.maxSize;
  assert.ok(effectiveAtMax >= s.floor * 0.999, "S* must clear the floor");

  const over = swapExactIn(p, true, BigInt(Math.floor(s.maxSize * 1.05 * 1e18)));
  const effectiveOver = Number(over.amountOut) / 1e6 / (s.maxSize * 1.05);
  assert.ok(effectiveOver < s.floor, "5% beyond S* must breach the floor");

  close(s.trancheSize, s.maxSize * DEFAULT_PARAMS.trancheFraction, s.maxSize * 1e-9, "τ·S*");
});

test("the desk never sells below its own basis", () => {
  const reference = 5;
  // Pool is dislocated well above reference, but the position cost more still.
  const s = sizeLiquidation(pool({ price: 7 }), reference, 1_000, 9);
  assert.equal(s.qualifies, false);
  assert.equal(s.floor, 9, "basis must bind when it exceeds reference + ε");
});

test("the full gate rejects in the documented order", () => {
  const reference = 5;

  const quiet = evaluate(pool({ price: 5.3 }), "AMC", reference, 1_000, 4);
  assert.equal(quiet.actionable, false);
  assert.match(quiet.blockedBy, /below δ\*/);

  // Inside the parking band, so it reaches the probe rather than being parked
  // first — a +500% print with nothing behind it is exactly the mirage case.
  const mirage = evaluate(pool({ price: 30, liquidity: 0n }), "KOSS", reference, 1_000, 4);
  assert.equal(mirage.actionable, false);
  assert.match(mirage.blockedBy, /mirage/);

  const parked = evaluate(pool({ price: 5000 }), "EXPR", reference, 1_000, 4);
  assert.equal(parked.actionable, false);
  assert.match(parked.blockedBy, /structural artifact/);

  const good = evaluate(pool({ price: 9, liquidity: 20_000n * 10n ** 12n }), "BBBY", reference, 10_000, 4.5);
  assert.equal(good.actionable, true, `expected actionable: ${good.blockedBy}`);
});

test("outside the session the threshold widens by θ", () => {
  const reference = 5;
  const p = pool({ price: 6.5, liquidity: 20_000n * 10n ** 12n }); // +30%

  assert.equal(evaluate(p, "AMC", reference, 10_000, 4, { sessionOpen: true }).blockedBy, null);

  const closed = evaluate(p, "AMC", reference, 10_000, 4, { sessionOpen: false });
  assert.equal(closed.actionable, false, "+30% must not clear a 35% closed-session threshold");
  assert.match(closed.blockedBy, /below δ\*/);
});

// --- The survey must measure thinness, not the dislocation it sits in -------

test("a deep book stays deep even when the pool is dislocated", () => {
  // Same book, same depth, only the price differs.
  const deepAtPar = pool({ price: 5, liquidity: 40_000_000n * 10n ** 12n, fee: 500 });
  const deepDislocated = pool({ price: 6.4, liquidity: 40_000_000n * 10n ** 12n, fee: 500 });

  assert.equal(classify(deepAtPar, 5).classification, "deep");
  assert.equal(
    classify(deepDislocated, 5).classification,
    "deep",
    "a +28% dislocation must not make a deep instrument look thin",
  );

  // The published reference-relative figure still reports the dislocation,
  // which is what it is for.
  assert.ok(impact(deepDislocated, 5, 1_000) > 0.25, "I(Q) vs reference still shows the premium");
  assert.ok(
    impactVsSpot(deepDislocated, 1_000) < 0.005,
    "impact vs spot isolates the book's own thinness",
  );
});

// --- Token identity ---------------------------------------------------------
// Robinhood's docs: "a token with a matching name/ticker but a different
// contract address is not a Robinhood Stock Token." An impostor is the one
// thing the rest of the gate cannot catch, because a fake token in a thin pool
// looks exactly like the opportunity the desk exists to take.

const REAL_AMC = "0xAbC0000000000000000000000000000000000001";
const canonical = new Set([REAL_AMC.toLowerCase()]);

const withAddress = (address) => ({
  ...pool({ price: 9, liquidity: 20_000n * 10n ** 12n }),
  token0: { symbol: "AMC", decimals: 18, address },
});

test("a canonical token passes the identity check and is surveyed normally", () => {
  const c = classify(withAddress(REAL_AMC), 5, { canonical });
  assert.notEqual(c.classification, "not-canonical");
  assert.ok(c.impact1k !== null, "a canonical token still gets measured");
});

test("an impostor with the right ticker is rejected outright", () => {
  const impostor = withAddress("0xdead000000000000000000000000000000000bad");

  const c = classify(impostor, 5, { canonical });
  assert.equal(c.classification, "not-canonical");
  assert.equal(c.impact1k, null, "an impostor is not even measured");

  // And it must never become actionable, however good the pool looks.
  const v = evaluate(impostor, "AMC", 5, 10_000, 4, { canonical });
  assert.equal(v.actionable, false);
  assert.match(v.blockedBy, /canonical/);
});

test("an impostor would otherwise have looked like a prime opportunity", () => {
  // Same pool, no registry supplied: thin book, +80% deviation, sells fine.
  const impostor = withAddress("0xdead000000000000000000000000000000000bad");
  const unguarded = evaluate(impostor, "AMC", 5, 10_000, 4);

  assert.equal(
    unguarded.actionable,
    true,
    "without the registry this fake token is a textbook actionable dislocation",
  );
});

test("an unknown token address is refused rather than assumed canonical", () => {
  const noAddress = {
    ...pool({ price: 9, liquidity: 20_000n * 10n ** 12n }),
    token0: { symbol: "AMC", decimals: 18 },
  };
  assert.equal(classify(noAddress, 5, { canonical }).classification, "not-canonical");
  assert.equal(evaluate(noAddress, "AMC", 5, 10_000, 4, { canonical }).actionable, false);
});

test("with no registry supplied the check is skipped, not silently passed", () => {
  const c = classify(withAddress(REAL_AMC), 5);
  assert.notEqual(c.classification, "not-canonical");
});

test("a tokenized ETF is refused as policy, not as a fake", async () => {
  const { ETF_TOKENS, STOCK_TOKENS, etfAddresses, tradableAddresses } =
    await import("../src/lib/chain.ts");

  const tradable = tradableAddresses();
  const etfs = etfAddresses();

  const spy = {
    ...pool({ price: 9, liquidity: 20_000n * 10n ** 12n }),
    token0: { symbol: "SPY", decimals: 18, address: ETF_TOKENS.SPY.address },
  };

  const c = classify(spy, 5, { canonical: tradable, etfs });
  assert.equal(c.classification, "excluded-etf");
  assert.match(c.reason, /categorically/);

  const v = evaluate(spy, "SPY", 5, 10_000, 4, { canonical: tradable, etfs });
  assert.equal(v.actionable, false);
  assert.match(v.blockedBy, /ETF/);

  // A real stock token in the same pool shape is allowed through.
  const amc = {
    ...pool({ price: 9, liquidity: 20_000n * 10n ** 12n }),
    token0: { symbol: "AMC", decimals: 18, address: STOCK_TOKENS.AMC.address },
  };
  assert.equal(evaluate(amc, "AMC", 5, 10_000, 4, { canonical: tradable, etfs }).actionable, true);
});
