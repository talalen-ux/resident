/**
 * Band policy.
 *
 * The claim being tested is not "this makes money" — a backtest cannot show
 * that. It is that each rule does what it says: width tracks volatility, the
 * entry test compares fees against bleed rather than against zero, and the net
 * stop keeps positions a gross stop would have thrown away.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  divergenceLoss as divergenceLossForStop,
  openBand as openBandForStop,
} from "../src/lib/sim/band.ts";
import {
  DEFAULT_WIDTH_CONFIG,
  bandWidth,
  evaluateEntry,
  expectedBleedRate,
  realisedVolatility,
} from "../src/lib/sim/strategy.ts";
import {
  DEFAULT_BAND_CONFIG,
  DEFAULT_MANAGED_CONFIG,
  backtestBand,
  backtestManaged,
} from "../src/lib/sim/backtest.ts";

const MINUTE = 60_000;

function walk(n, start, vol, seed = 7) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * Math.exp((rand() * 2 - 1) * vol * 1.732));
  return out;
}

const history = ({ prices, volume = 50_000, liquidity = 100_000, feePips = 3000 }) => ({
  pool: "0xtest",
  pair: "TEST/USDG",
  feePips,
  intervalMs: MINUTE,
  candles: prices.map((price, i) => ({
    t: i * MINUTE, price, reference: price, volume, liquidity,
  })),
});

// --- volatility and width ---------------------------------------------------

test("realised volatility recovers the volatility it was generated with", () => {
  for (const vol of [0.002, 0.01, 0.03]) {
    const measured = realisedVolatility(walk(20_000, 5, vol));
    assert.ok(
      Math.abs(measured - vol) / vol < 0.1,
      `generated ${vol}, measured ${measured.toFixed(5)}`,
    );
  }
});

test("a flat series has no volatility", () => {
  assert.equal(realisedVolatility(Array(500).fill(5)), 0);
});

test("width scales with volatility and with the square root of the horizon", () => {
  const w1 = bandWidth(0.004);
  const w2 = bandWidth(0.008);
  assert.ok(Math.abs(w2 / w1 - 2) < 1e-9, "twice the vol, twice the width");

  const short = bandWidth(0.004, { ...DEFAULT_WIDTH_CONFIG, horizon: 60 });
  const long = bandWidth(0.004, { ...DEFAULT_WIDTH_CONFIG, horizon: 240 });
  assert.ok(Math.abs(long / short - 2) < 1e-9, "four times the horizon, twice the width");
});

test("width is clamped at both ends", () => {
  assert.equal(bandWidth(0), DEFAULT_WIDTH_CONFIG.minWidth);
  assert.equal(bandWidth(10), DEFAULT_WIDTH_CONFIG.maxWidth);
});

test("the sigma multiple actually delivers roughly its target time in range", () => {
  // Calibration check: with the default multiple, a band opened on a random
  // walk of the volatility it was sized for should hold most of its horizon.
  const vol = 0.004;
  const horizon = DEFAULT_WIDTH_CONFIG.horizon;
  const w = bandWidth(vol);

  let inRangeTotal = 0;
  const trials = 200;
  for (let s = 0; s < trials; s++) {
    const path = walk(horizon, 1, vol, 1000 + s);
    inRangeTotal += path.filter((p) => p >= 1 - w && p <= 1 + w).length / horizon;
  }
  const fraction = inRangeTotal / trials;
  // The calibration table in strategy.ts puts 1.25σ at ~91%.
  assert.ok(
    fraction > 0.85 && fraction < 0.95,
    `expected ~91% time in range at the default multiple, got ${(fraction * 100).toFixed(1)}%`,
  );
});

// --- the bleed --------------------------------------------------------------

test("expected bleed rises with volatility and falls with width", () => {
  assert.ok(expectedBleedRate(0.05, 0.02) > expectedBleedRate(0.05, 0.01));
  assert.ok(expectedBleedRate(0.02, 0.01) > expectedBleedRate(0.2, 0.01));
  assert.equal(expectedBleedRate(0.05, 0), 0);
});

// --- entry ------------------------------------------------------------------

test("a fee-rich, quiet pool is entered", () => {
  const v = evaluateEntry({
    volume: 200_000, liquidity: 50_000, feePips: 20_000,
    volatility: 0.002, deployed: 8_500, captureEfficiency: 1,
  });
  assert.equal(v.enter, true, v.reason);
  assert.ok(v.netRate > 0);
  assert.ok(v.feeRate > v.bleedRate);
});

test("a violent pool is declined however big its fee tier", () => {
  // A 5% tier on a book moving 8% an interval, at a realistic turnover.
  const v = evaluateEntry({
    volume: 3_000, liquidity: 20_000, feePips: 50_000,
    volatility: 0.08, deployed: 8_500, captureEfficiency: 1,
  });
  assert.equal(v.enter, false, "the bleed must be allowed to veto a fat fee tier");
  assert.match(v.reason, /swamps/);
});

test("volatility hits both sides of the trade, not just the bleed", () => {
  // Identical pool economics — same flow, same fee tier, same competing
  // liquidity. Only the volatility differs.
  const base = {
    volume: 20_000, liquidity: 60_000, feePips: 3_000,
    deployed: 8_500, captureEfficiency: 1,
  };
  const quiet = evaluateEntry({ ...base, volatility: 0.001 });
  const wild = evaluateEntry({ ...base, volatility: 0.06 });

  // Volatility widens the band, which costs income as well as adding bleed.
  assert.ok(wild.halfWidth > quiet.halfWidth, "a rougher pool needs a wider band");
  assert.ok(wild.share < quiet.share, "and a wider band takes less of the flow");
  assert.ok(wild.feeRate < quiet.feeRate, "so the same pool pays it less");
  assert.ok(wild.bleedRate > quiet.bleedRate, "while costing it more");

  assert.equal(quiet.enter, true, quiet.reason);
  assert.equal(wild.enter, false, wild.reason);
});

test("capture efficiency feeds straight through to the verdict", () => {
  const base = {
    volume: 60_000, liquidity: 90_000, feePips: 3_000,
    volatility: 0.006, deployed: 8_500,
  };
  const bound = evaluateEntry({ ...base, captureEfficiency: 1 });
  const real = evaluateEntry({ ...base, captureEfficiency: 0.145 });

  assert.ok(real.feeRate < bound.feeRate);
  assert.ok(
    real.netRate < bound.netRate,
    "using the upper bound as if it were the estimate flatters every entry",
  );
});

// --- managed vs fixed -------------------------------------------------------

test("the managed desk stands down in conditions the fixed one holds through", () => {
  // Violent, low-fee: the fixed band holds regardless, the policy declines.
  const prices = walk(3_000, 5, 0.05);
  const h = history({ prices, volume: 500, liquidity: 200_000 });

  const fixed = backtestBand(h, { ...DEFAULT_BAND_CONFIG, stopLossFraction: 1 });
  const managed = backtestManaged(h);

  assert.ok(managed.standDowns > 0, "the policy should refuse this pool");
  assert.ok(
    managed.net > fixed.net,
    `standing down should beat holding: managed ${managed.net.toFixed(0)} vs fixed ${fixed.net.toFixed(0)}`,
  );
});

test("in a pool worth holding, the managed desk stays deployed", () => {
  const prices = walk(3_000, 5, 0.002);
  const h = history({ prices, volume: 300_000, liquidity: 60_000, feePips: 20_000 });
  const managed = backtestManaged(h);

  assert.ok(managed.intervalsDeployed > 2_000, "it should hold a pool this good");
  assert.ok(managed.net > 0);
  assert.ok(managed.timeInRange > 0.7, `time in range ${(managed.timeInRange * 100).toFixed(0)}%`);
});

test("width adapts to the pool rather than being a constant", () => {
  const calm = backtestManaged(
    history({ prices: walk(3_000, 5, 0.001), volume: 200_000, liquidity: 60_000, feePips: 20_000 }),
  );
  const rough = backtestManaged(
    history({ prices: walk(3_000, 5, 0.01), volume: 200_000, liquidity: 60_000, feePips: 20_000 }),
  );

  assert.ok(
    rough.medianWidth > calm.medianWidth * 2,
    `a rougher pool must get a wider band: ${calm.medianWidth.toFixed(4)} vs ${rough.medianWidth.toFixed(4)}`,
  );
});

test("both stops net fees against the loss before firing", () => {
  // Heavy fees, then a 28% drawdown. Neither should retire: the fees banked
  // beforehand more than cover it. Recorded because an earlier version of this
  // file claimed the fixed backtest used a gross stop and the managed one a net
  // stop — it does not; both are net, and no advantage is claimed for it.
  const prices = [...Array(1_500).fill(5), ...Array(600).fill(3.6)];
  const h = history({ prices, volume: 400_000, liquidity: 40_000, feePips: 20_000 });

  const fixed = backtestBand(h, { ...DEFAULT_BAND_CONFIG, stopLossFraction: 0.35 });
  const managed = backtestManaged(h, {
    ...DEFAULT_MANAGED_CONFIG,
    entry: { ...DEFAULT_MANAGED_CONFIG.entry, minNetRate: -Infinity },
  });

  assert.equal(fixed.retired, false, "fees banked should have paid for the move");
  assert.equal(managed.retired, false);
  assert.ok(fixed.net > 0 && managed.net > 0);
});

test("a 35% stop needs a near-total collapse to fire on divergence alone", () => {
  // Divergence loss against holding is bounded: once the band converts fully to
  // the volatile side, what is lost is the quote half, and it converges toward
  // ~50% of capital rather than growing without limit. So a −50% move costs
  // about 21% and does NOT trip a 35% stop; it takes roughly −85%.
  const survives = backtestBand(
    history({ prices: [...Array(100).fill(5), ...Array(600).fill(2.5)], volume: 0 }),
    { ...DEFAULT_BAND_CONFIG, stopLossFraction: 0.35 },
  );
  assert.equal(survives.retired, false, "−50% is only ~21% of capital");

  const fires = backtestBand(
    history({ prices: [...Array(100).fill(5), ...Array(600).fill(0.5)], volume: 0 }),
    { ...DEFAULT_BAND_CONFIG, stopLossFraction: 0.35 },
  );
  assert.equal(fires.retired, true, "−90% does trip it");
});

test("the real risk is the token, not the divergence", () => {
  // The corollary of the bound above: a two-sided band's divergence loss is
  // capped near the quote half, so a "max loss 35%" stop is close to inert
  // against price moves. What it cannot bound is the token going to zero, which
  // costs the whole volatile side regardless of any band setting.
  const band = openBandForStop(5, 0.05, 8_500);
  const atRuin = -divergenceLossForStop(band, 0.001) * 8_500;
  assert.ok(atRuin / 8_500 > 0.45, "a collapse costs about the quote half");
  assert.ok(atRuin / 8_500 < 0.55, "and is bounded there, not unbounded");
});

test("warmup means no position is taken before volatility can be measured", () => {
  const h = history({ prices: walk(40, 5, 0.004), volume: 200_000 });
  const managed = backtestManaged(h);
  assert.equal(managed.intervalsDeployed, 0, "40 intervals is under the 60-interval warmup");
  assert.equal(managed.net, 0);
});
