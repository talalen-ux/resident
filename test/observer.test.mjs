/**
 * The join between what the chain says and what decide.ts consumes.
 *
 * Most of these assert a refusal to flatter: a position that has stopped
 * earning must read as stopped, not as the rate a freshly centred band would
 * make, and fees must never be folded into value.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  currentRate,
  observePosition,
  ratesFrom,
  toUnits,
} from "../src/lib/keeper/observer.ts";
import { priceAtTick } from "../src/lib/keeper/position-reader.ts";

const position = {
  id: "p1",
  chain: "robinhood",
  pool: "AI/USDG",
  kind: "band",
  handle: "42",
  capital: 10_000,
  lower: 0.9,
  upper: 1.1,
  openedAt: 0,
  feesSwept: 0,
  lastSweptAt: 0,
};

/** A position of 1e12 raw liquidity across +/-100 ticks, both sides 6dp. */
const read = (over = {}) => ({
  tokenId: "42",
  tickLower: -100,
  tickUpper: 100,
  liquidity: 10n ** 12n,
  fees0: 0n,
  fees1: 0n,
  currency0: "0x11",
  currency1: "0x22",
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x0",
  ...over,
});

const base = {
  price: 1,
  decimals0: 6,
  decimals1: 6,
  quoteIsToken1: true,
  volume: 5_000,
  liquidity: 500_000,
  volatility: 0.002,
  captureEfficiency: 0.5,
  freshHalfWidth: 0.04,
  series: undefined,
  now: 3_600_000,
  intervalMs: 60_000,
};

test("a position whose price has left its range earns nothing", () => {
  const inside = currentRate({
    price: 1, lower: 0.99, upper: 1.01, value: 10_000,
    volume: 5_000, liquidity: 500_000, feePips: 3000,
    volatility: 0.002, captureEfficiency: 0.5,
  });
  const outside = currentRate({
    price: 1.5, lower: 0.99, upper: 1.01, value: 10_000,
    volume: 5_000, liquidity: 500_000, feePips: 3000,
    volatility: 0.002, captureEfficiency: 0.5,
  });
  assert.ok(inside !== 0, "a position straddling spot should have a rate");
  // Not "a small rate". Zero. A position out of range is earning nothing at
  // all, and any positive number here argues for holding it.
  assert.equal(outside, 0);
});

test("the bleed is charged against the near edge, not the average of both", () => {
  const centred = currentRate({
    price: 1, lower: 0.95, upper: 1.05, value: 10_000,
    volume: 5_000, liquidity: 500_000, feePips: 3000,
    volatility: 0.002, captureEfficiency: 0.5,
  });
  const atTheEdge = currentRate({
    price: 1.049, lower: 0.95, upper: 1.05, value: 10_000,
    volume: 5_000, liquidity: 500_000, feePips: 3000,
    volatility: 0.002, captureEfficiency: 0.5,
  });
  // Same band, same pool. The one about to fall out of range must price worse.
  assert.ok(
    atTheEdge < centred,
    `edge ${atTheEdge} should be worse than centred ${centred}`,
  );
});

test("a worthless position rates zero rather than dividing by it", () => {
  const rate = currentRate({
    price: 1, lower: 0.9, upper: 1.1, value: 0,
    volume: 5_000, liquidity: 500_000, feePips: 3000,
    volatility: 0.002, captureEfficiency: 0.5,
  });
  assert.equal(rate, 0);
});

test("fees are converted to quote units and never folded into value", () => {
  const observed = observePosition({
    ...base,
    position,
    // 100 of token0 and 250 of token1, both 6dp, at a price of 1.
    read: read({ fees0: 100_000_000n, fees1: 250_000_000n }),
    price: 1,
  });
  assert.equal(observed.feesUnclaimed, 350);
  // The value must be the principal alone. If fees leaked in, this would be
  // 350 higher and every net figure downstream would double-count them.
  const withoutFees = observePosition({ ...base, position, read: read() });
  assert.equal(observed.value, withoutFees.value);
});

test("fees on the non-quote side are converted at the pool price", () => {
  const observed = observePosition({
    ...base,
    position,
    read: read({ fees0: 100_000_000n, fees1: 0n }),
    price: 3,
    quoteIsToken1: true,
  });
  // 100 of token0 at 3 quote each.
  assert.equal(observed.feesUnclaimed, 300);
});

test("unrealised is measured against committed capital, not against zero", () => {
  const observed = observePosition({ ...base, position, read: read() });
  assert.equal(
    observed.unrealised,
    observed.value - position.capital,
    "unrealised must be value less cost basis",
  );
});

test("the rate history is rebuilt from the journal and ends with the live rate", () => {
  const series = {
    positionId: "p1",
    marks: [
      { at: 1, value: 1, feesUnclaimed: 0, price: 1, rate: 0.001 },
      { at: 2, value: 1, feesUnclaimed: 0, price: 1, rate: 0.002 },
      // A mark from before the field existed. It must not become a zero, which
      // would look like a dead interval and drag a position towards retirement.
      { at: 3, value: 1, feesUnclaimed: 0, price: 1 },
      { at: 4, value: 1, feesUnclaimed: 0, price: 1, rate: 0.003 },
    ],
    sweeps: [],
  };
  assert.deepEqual(ratesFrom(series), [0.001, 0.002, 0.003]);

  const observed = observePosition({ ...base, position, read: read(), series });
  assert.equal(observed.recentRates.length, 4);
  assert.deepEqual(observed.recentRates.slice(0, 3), [0.001, 0.002, 0.003]);
  assert.equal(observed.recentRates.at(-1), observed.currentRate);
});

test("an absent series is an empty history, not a crash", () => {
  assert.deepEqual(ratesFrom(undefined), []);
});

test("age and sweep gaps are counted in intervals", () => {
  const observed = observePosition({
    ...base,
    position: { ...position, openedAt: 0, lastSweptAt: 1_800_000 },
    read: read(),
    now: 3_600_000,
    intervalMs: 60_000,
  });
  assert.equal(observed.ageIntervals, 60);
  assert.equal(observed.intervalsSinceSweep, 30);
});

test("fresh bounds bracket the current price by the model's width", () => {
  const observed = observePosition({
    ...base, position, read: read(), price: 2, freshHalfWidth: 0.05,
  });
  assert.equal(observed.freshLower, 1.9);
  assert.equal(observed.freshUpper, 2.1);
});

test("bounds come from the position's ticks, not from the journal record", () => {
  // The journal says 0.9/1.1. The chain says +/-100 ticks, which is about
  // 0.99/1.01. The chain is the one that decides whether fees are accruing, so
  // a price of 1.05 must read as out of range.
  const observed = observePosition({
    ...base,
    position,
    read: read({ tickLower: -100, tickUpper: 100 }),
    price: 1.05,
  });
  assert.ok(priceAtTick(100, 6, 6) < 1.05, "fixture assumes 1.05 is above the band");
  assert.equal(observed.currentRate, 0);
});

test("raw units convert by decimals", () => {
  assert.equal(toUnits(1_500_000n, 6), 1.5);
  assert.equal(toUnits(10n ** 18n, 18), 1);
  assert.equal(toUnits(0n, 6), 0);
});
