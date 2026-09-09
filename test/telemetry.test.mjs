/**
 * The per-pool card.
 *
 * The assertions that matter here are about what the card REFUSES to show. A
 * dashboard that fills an unmeasured field with zero is not a dashboard with a
 * small bug; it is one that reports "we did not look" and "there was none" with
 * the same glyph.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildCard, feedStatus, splitAt } from "../src/lib/desk/telemetry.ts";
import { deviationFrom, referenceFor } from "../src/lib/desk/reference.ts";
import { buildPool } from "../src/lib/sim/pools.ts";
import { seriesFrom } from "../src/lib/keeper/marks.ts";

const MINUTE = 60_000;

const pool = (over = {}) =>
  buildPool({
    price: 5,
    liquidity: 20_000n * 10n ** 12n,
    fee: 3000,
    token0: { symbol: "AMC", decimals: 18 },
    token1: { symbol: "USDG", decimals: 6 },
    ...over,
  });

const observation = (over = {}) => ({
  address: "0xpool",
  pool: pool(),
  volume: { m5: 9_000, h1: 120_000, h6: 600_000, h24: 2_000_000 },
  peak24h: 5.2,
  ageMinutes: 240,
  hasHook: false,
  smartLpNet: 2,
  smartLpPresent: 3,
  smartLpExited1h: 1,
  swaps1h: 48,
  flow1h: -12_000,
  ...over,
});

const self = { address: "0xpool", base: "amc", quote: "usdg", price: 5, volume24h: 2_000_000 };

const card = (over = {}) =>
  buildCard({
    observation: observation(),
    pair: "AMC/USDG",
    peers: [],
    self,
    position: null,
    series: null,
    netWindowMs: 6 * 60 * MINUTE,
    netWindowLabel: "6h",
    now: 1_000_000,
    captureEfficiency: 1,
    ...over,
  });

const position = (over = {}) => ({
  capital: 10_000, lower: 4.5, upper: 5.5, feesInside: 42, sinceSweepMs: 90_000, ...over,
});

test("a field we did not measure is null, never zero", () => {
  const c = card();
  assert.equal(c.fees1h, null, "no position means no share, so no fee estimate");
  assert.equal(c.atWork, null);
  assert.equal(c.range, null);
  assert.equal(c.net, null);
  assert.equal(c.vsReference, null, "no peers is no reference, not a zero gap");
});

/** A pool deep enough that a $10k position is a share of it rather than all of it. */
const deep = () => observation({ pool: pool({ liquidity: 2_000_000n * 10n ** 12n }) });

test("with a position open the earning fields are computed", () => {
  const c = card({ observation: deep(), position: position() });
  assert.ok(c.fees1h > 0);
  assert.ok(c.fees24h > c.fees1h);
  assert.equal(c.atWork, 10_000);
  assert.equal(c.feesInside, 42);
  assert.ok(c.ourShare > 0 && c.ourShare < 1);
  assert.equal(c.swapsPerHour, 48);
  assert.equal(c.flow1h, -12_000);
});

/**
 * Being the entire band is a real outcome on a thin pool, and the share the
 * card shows has to say so rather than exceeding one or going negative.
 */
test("a position that is the whole band shows a share of one", () => {
  const c = card({ position: position({ capital: 10_000 }) });
  assert.equal(c.ourShare, 1);
});

test("the range bar says where the price sits, and whether it is earning", () => {
  const { range } = card({ position: position() });
  assert.equal(range.inRange, true);
  assert.ok(Math.abs(range.position - 0.5) < 1e-9, "mid-range");

  const below = card({ position: position({ lower: 6, upper: 7 }) }).range;
  assert.equal(below.inRange, false);
  assert.equal(below.position, 0, "clamped, never off the end of the bar");
});

/**
 * The split is the operator's real exposure. Capital alone shows $10k of
 * "capital" where the position is in fact $10k of a token that just fell into
 * the bottom of its range.
 */
test("at the bottom of the range the position is all token", () => {
  const bottom = splitAt(position(), 4.5);
  assert.ok(bottom.base > 0.99, `base ${bottom.base}`);
  const top = splitAt(position(), 5.5);
  assert.ok(top.quote > 0.99, `quote ${top.quote}`);
  const mid = splitAt(position(), 5);
  assert.ok(mid.quote > 0.4 && mid.quote < 0.6);
});

test("the split always sums to one, wherever the price is", () => {
  for (const price of [1, 4.4, 4.5, 5, 5.5, 9]) {
    const s = splitAt(position(), price);
    assert.ok(Math.abs(s.quote + s.base - 1) < 1e-9, `at ${price}`);
  }
});

/* --------------------------------------------------------------- reference */

test("a pool is never its own reference", () => {
  assert.equal(referenceFor(self, [self]), null);
});

test("the reference is weighted by volume, not averaged", () => {
  const peers = [
    { address: "0xa", base: "amc", quote: "usdg", price: 5.0, volume24h: 9_000_000 },
    { address: "0xb", base: "amc", quote: "usdg", price: 6.0, volume24h: 1_000_000 },
  ];
  const reference = referenceFor(self, peers);
  assert.equal(reference.sources, 2);
  assert.ok(Math.abs(reference.price - 5.1) < 1e-9, `${reference.price}`);
});

test("a different quote asset is not a comparable market", () => {
  const peers = [{ address: "0xc", base: "amc", quote: "sol", price: 0.03, volume24h: 5_000_000 }];
  assert.equal(referenceFor(self, peers), null);
});

test("a pool quoting far from everywhere else is flagged, not traded", () => {
  const peers = [{ address: "0xa", base: "amc", quote: "usdg", price: 4.0, volume24h: 5_000_000 }];
  const d = deviationFrom(5, referenceFor(self, peers));
  assert.ok(Math.abs(d.deviation - 0.25) < 1e-9);
  assert.equal(d.stale, true);

  const tight = deviationFrom(4.05, referenceFor(self, peers));
  assert.equal(tight.stale, false);
});

test("no reference is null, so the card cannot render a zero gap", () => {
  assert.equal(deviationFrom(5, null), null);
});

test("the card carries the deviation and how many pools stand behind it", () => {
  const peers = [{ address: "0xa", base: "amc", quote: "usdg", price: 4.0, volume24h: 5_000_000 }];
  const c = card({ peers });
  assert.equal(c.vsReference.sources, 1);
  assert.equal(c.vsReference.stale, true);
});

/* --------------------------------------------------------------------- net */

test("net on the card is fees less what the principal lost", () => {
  const now = 7 * 60 * MINUTE;
  const series = seriesFrom([
    { at: 0, kind: "mark", positionId: "p1", value: 10_000, feesUnclaimed: 0, price: 5 },
    { at: now, kind: "mark", positionId: "p1", value: 9_500, feesUnclaimed: 300, price: 4.7 },
  ]).get("p1");
  const c = card({ position: position(), series, now });
  assert.equal(c.net.window, "6h");
  assert.equal(c.net.fees, 300);
  assert.equal(c.net.principal, -500);
  assert.equal(c.net.net, -200);
  assert.ok(c.net.rate < 0, "and it is published negative");
});

/* -------------------------------------------------------------------- feed */

test("a keeper that has never run does not read as live", () => {
  const status = feedStatus(0, 1_000_000);
  assert.equal(status.live, false);
  assert.equal(status.note, "never ran");
});

test("a stale heartbeat is stale, however quiet the pools are", () => {
  assert.equal(feedStatus(1_000_000 - 30_000, 1_000_000).live, true);
  const dead = feedStatus(1_000_000 - 40 * MINUTE, 1_000_000);
  assert.equal(dead.live, false);
  assert.match(dead.note, /no heartbeat for 40 minutes/);
});
