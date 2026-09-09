/**
 * Quote assets, and the conversion that has to happen once there is a second
 * one.
 *
 * The failures guarded against here are silent and asymmetric: measuring a
 * WETH-quoted pool's volume against a dollar threshold rejects every pool that
 * qualifies, and measuring its depth against a dollar cap waves through a pool
 * several times deeper than the cap allows. The second one loses money.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  QUOTE_ASSETS,
  deriveRates,
  isQuoteAsset,
  quoteAssetAt,
  usdPerQuote,
} from "../src/lib/desk/quotes.ts";
import { DEFAULT_ALERT_CONFIG, evaluatePool } from "../src/lib/sim/opportunity.ts";
import { buildPool } from "../src/lib/sim/pools.ts";
import { TOKENS } from "../src/lib/chain.ts";

test("both quote assets are addressable, and nothing else is", () => {
  assert.equal(QUOTE_ASSETS.length, 2);
  assert.equal(quoteAssetAt(TOKENS.usdg).symbol, "USDG");
  assert.equal(quoteAssetAt(TOKENS.weth.toUpperCase()).symbol, "WETH");
  assert.equal(quoteAssetAt("0xdead"), null);
  assert.equal(isQuoteAsset(TOKENS.weth), true);
});

test("a stable quote is a dollar without a rate; ether is not", () => {
  assert.equal(usdPerQuote("USDG", {}), 1);
  assert.equal(usdPerQuote("WETH", {}), null, "no rate is null, never 1");
  assert.equal(usdPerQuote("WETH", { WETH: 3100 }), 3100);
  assert.equal(usdPerQuote("WETH", { WETH: 0 }), null);
  assert.equal(usdPerQuote("SOL", { SOL: 200 }), null, "not a quote asset here");
});

test("the rate comes from the busiest market, not the first or an average", () => {
  const rates = deriveRates([
    { base: "WETH", quote: "USDG", price: 9_999, volume24h: 5 },
    { base: "WETH", quote: "USDG", price: 3_100, volume24h: 4_000_000 },
  ]);
  assert.equal(rates.WETH, 3_100, "a dead pool must not drag the rate");
});

test("a market that cannot price a quote asset is ignored", () => {
  assert.deepEqual(deriveRates([{ base: "AMC", quote: "USDG", price: 5, volume24h: 1e6 }]), {});
  assert.deepEqual(deriveRates([{ base: "WETH", quote: "AMC", price: 600, volume24h: 1e6 }]), {});
  assert.deepEqual(deriveRates([{ base: "WETH", quote: "USDG", price: 0, volume24h: 1e6 }]), {});
  assert.deepEqual(deriveRates([{ base: "USDG", quote: "USDG", price: 1, volume24h: 1e6 }]), {});
});

/* ------------------------------------------------- the gate, on a real pool */

const wethPool = () =>
  buildPool({
    price: 0.0016, // a stock token priced in ether
    liquidity: 20_000n * 10n ** 12n,
    fee: 3000,
    token0: { symbol: "AMC", decimals: 18 },
    token1: { symbol: "WETH", decimals: 18 },
  });

const wethObs = (over = {}) => ({
  address: "0xweth",
  pool: wethPool(),
  // Roughly $25k an hour at $3,100 an ether, which is exactly the threshold.
  volume: { m5: 0.6, h1: 8.1, h6: 48, h24: 190 },
  peak24h: 0.00166,
  ageMinutes: 240,
  hasHook: false,
  smartLpNet: 3,
  smartLpPresent: 4,
  smartLpExited1h: 0,
  ...over,
});

const gate = (alert, name) => alert.gates.find((g) => g.name === name);

test("a WETH pool with no rate is held, not measured in the wrong unit", () => {
  const alert = evaluatePool(wethObs());
  assert.equal(alert.qualifies, false);
  const g = gate(alert, "priced in dollars");
  assert.equal(g.passed, false);
  assert.match(g.detail, /no USD rate for WETH/);
});

test("the same pool, priced, clears the volume threshold it would have failed", () => {
  const unpriced = evaluatePool(wethObs());
  assert.equal(gate(unpriced, "volume").passed, false, "8 WETH is not $25,000");

  const priced = evaluatePool(wethObs({ quoteUsd: 3_100 }));
  assert.equal(gate(priced, "priced in dollars").passed, true);
  assert.equal(gate(priced, "volume").passed, true);
  assert.ok(
    priced.fees.h1 > unpriced.fees.h1 * 1_000,
    "every dollar figure scales with the rate",
  );
});

/**
 * The dangerous direction. Depth is capped so the desk is never one small voice
 * in a crowded pool. Read in ether, that cap is three thousand times too
 * generous: this pool holds 134 WETH near the price, which passes a cap of
 * 400,000 comfortably and is $417,000 of competition.
 */
test("the depth cap is applied in dollars, not in ether", () => {
  const crowded = {
    ...wethObs(),
    pool: buildPool({
      price: 0.0016,
      liquidity: 68_000_000_000n * 10n ** 12n,
      fee: 3000,
      token0: { symbol: "AMC", decimals: 18 },
      token1: { symbol: "WETH", decimals: 18 },
    }),
  };

  const inEther = evaluatePool({ ...crowded, quoteUsd: 1 });
  assert.ok(inEther.inBandLiquidity < DEFAULT_ALERT_CONFIG.maxBandLiquidity);
  assert.equal(
    gate(inEther, "depth under the cap").passed,
    true,
    "unconverted, a pool this crowded sails through the cap",
  );

  const priced = evaluatePool({ ...crowded, quoteUsd: 3_100 });
  assert.ok(
    Math.abs(priced.inBandLiquidity / inEther.inBandLiquidity - 3_100) < 1,
    "depth scales by exactly the rate",
  );
  assert.ok(priced.inBandLiquidity > DEFAULT_ALERT_CONFIG.maxBandLiquidity);
  assert.equal(gate(priced, "depth under the cap").passed, false);
});

test("the price on the card is dollars per stock token", () => {
  const alert = evaluatePool(wethObs({ quoteUsd: 3_100 }));
  assert.ok(alert.price > 4 && alert.price < 6, `got ${alert.price}`);
  assert.equal(alert.quote, "WETH");
  assert.equal(alert.quoteUsd, 3_100);
});

test("holding its range is a ratio, so the rate cannot change it", () => {
  const a = evaluatePool(wethObs({ quoteUsd: 3_100 }));
  const b = evaluatePool(wethObs({ quoteUsd: 1 }));
  assert.equal(
    gate(a, "holding its range").detail,
    gate(b, "holding its range").detail,
  );
});

test("a USDG pool is unaffected by any of this", () => {
  const usdg = {
    address: "0xusdg",
    pool: buildPool({
      price: 5,
      liquidity: 20_000n * 10n ** 12n,
      fee: 3000,
      token0: { symbol: "AMC", decimals: 18 },
      token1: { symbol: "USDG", decimals: 6 },
    }),
    volume: { m5: 9_000, h1: 120_000, h6: 600_000, h24: 2_000_000 },
    peak24h: 5.2,
    ageMinutes: 240,
    hasHook: false,
    smartLpNet: 3,
    smartLpPresent: 4,
    smartLpExited1h: 0,
    quoteUsd: 1,
  };
  const alert = evaluatePool(usdg);
  assert.equal(gate(alert, "priced in dollars").detail, "quoted in USDG");
  assert.ok(Math.abs(alert.price - 5) < 1e-6);
});
