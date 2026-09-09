/**
 * Opportunity engine and smart-LP tracker.
 *
 * The band-earnings math is checked against arithmetic that can be done by
 * hand, and each gate is checked by moving exactly one input across its
 * threshold — so a passing test means that gate is what rejected the pool.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ALERT_CONFIG,
  bandShare,
  buildBoard,
  estimateFees,
  evaluatePool,
  liquidityInBand,
} from "../src/lib/sim/opportunity.ts";
import {
  DEFAULT_TRACKER_CONFIG,
  scoreWallets,
  summarisePool,
} from "../src/lib/sim/smart-lp.ts";
import { buildPool } from "../src/lib/sim/pools.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const pool = (over = {}) =>
  buildPool({
    price: 5,
    liquidity: 20_000n * 10n ** 12n,
    fee: 3000,
    token0: { symbol: "AMC", decimals: 18 },
    token1: { symbol: "USDG", decimals: 6 },
    ...over,
  });

const obs = (over = {}) => ({
  address: "0xpool",
  pool: pool(over.poolOpts ?? {}),
  volume: { m5: 9_000, h1: 120_000, h6: 600_000, h24: 2_000_000 },
  peak24h: 5.2,
  ageMinutes: 240,
  hasHook: false,
  // A USDG pool: a unit of the quote is a dollar by construction.
  quoteUsd: 1,
  smartLpNet: 3,
  smartLpPresent: 4,
  smartLpExited1h: 0,
  ...over,
});

// --- band economics --------------------------------------------------------

test("band share is the band against the liquidity it competes with", () => {
  assert.equal(bandShare(10_000, 90_000), 0.1);
  assert.equal(bandShare(10_000, 10_000), 0.5);
  assert.equal(bandShare(10_000, 0), 1, "an empty band range is taken entirely");
});

test("fee estimate is volume × fee tier × share", () => {
  const fees = estimateFees(
    { m5: 1_000, h1: 100_000, h6: 500_000, h24: 1_000_000 },
    3000, // 0.3%
    0.25,
  );
  // 100,000 × 0.003 × 0.25 = 75
  assert.equal(fees.h1, 75);
  assert.equal(fees.h24, 750);
});

test("in-band liquidity counts both sides and scales with pool liquidity", () => {
  const thin = liquidityInBand(pool({ liquidity: 20_000n * 10n ** 12n }), 0.05);
  const deep = liquidityInBand(pool({ liquidity: 200_000n * 10n ** 12n }), 0.05);

  assert.ok(thin > 0, "a live pool has liquidity in band");
  const ratio = deep / thin;
  assert.ok(Math.abs(ratio - 10) < 0.01, `10× the liquidity is 10× in band, got ${ratio}`);

  assert.equal(liquidityInBand(pool({ liquidity: 0n }), 0.05), 0);
});

test("a wider band captures more of the book", () => {
  const p = pool();
  assert.ok(liquidityInBand(p, 0.1) > liquidityInBand(p, 0.05));
});

test("a thinner pool gives the band a bigger share and a bigger estimate", () => {
  const thin = evaluatePool(obs({ poolOpts: { liquidity: 20_000n * 10n ** 12n } }));
  const deep = evaluatePool(obs({ poolOpts: { liquidity: 400_000n * 10n ** 12n } }));

  assert.ok(thin.share > deep.share);
  assert.ok(thin.fees.h1 > deep.fees.h1);
});

// --- the gates, one input at a time ---------------------------------------

test("a healthy pool qualifies", () => {
  const a = evaluatePool(obs());
  assert.equal(a.qualifies, true, a.gates.filter((g) => !g.passed).map((g) => g.name).join(", "));
  assert.equal(a.bandLine.size, 10_000);
  assert.ok(a.bandLine.lower < a.price && a.bandLine.upper > a.price);
});

const gateCases = [
  ["volume", { volume: { m5: 100, h1: 5_000, h6: 20_000, h24: 60_000 } }],
  ["holding its range", { peak24h: 20 }],
  ["old enough", { ageMinutes: 5 }],
  ["LPs winning", { smartLpNet: -2 }],
];

/**
 * The correction. A dynamic fee is implemented with a hook, so every pool
 * quoting something other than a static tier has one — and those were the
 * best-performing pools on the chain. Rejecting hooks rejected the market.
 *
 * What matters is whether the fee reaches the position, which slot0 reports
 * directly and readV4Pool puts on the pool.
 */
test("a hooked pool charging a real fee qualifies", () => {
  const a = evaluatePool(obs({ hasHook: true }));
  assert.equal(
    a.qualifies,
    true,
    a.gates.filter((g) => !g.passed).map((g) => g.name).join(", "),
  );
  const fee = a.gates.find((g) => g.name === "the LP fee reaches us");
  assert.match(fee.detail, /dynamic/, "a hooked pool should be marked dynamic");
});

test("a hook that leaves no fee for the position is rejected", () => {
  const a = evaluatePool(obs({ hasHook: true, poolOpts: { fee: 0 } }));
  assert.equal(a.qualifies, false);
  const failed = a.gates.filter((g) => !g.passed).map((g) => g.name);
  assert.deepEqual(failed, ["the LP fee reaches us"]);
});

test("hooks can still be rejected wholesale, for an operator who wants that", () => {
  const a = evaluatePool(obs({ hasHook: true }), {
    ...DEFAULT_ALERT_CONFIG,
    rejectHooks: true,
  });
  assert.equal(a.qualifies, false);
  assert.deepEqual(
    a.gates.filter((g) => !g.passed).map((g) => g.name),
    ["the LP fee reaches us"],
  );
});

for (const [gate, override] of gateCases) {
  test(`the "${gate}" gate rejects on its own`, () => {
    const a = evaluatePool(obs(override));
    assert.equal(a.qualifies, false);
    const failed = a.gates.filter((g) => !g.passed).map((g) => g.name);
    assert.deepEqual(failed, [gate], `expected only ${gate} to fail, got ${failed}`);
  });
}

test("the depth cap rejects a pool that is too deep to matter", () => {
  const a = evaluatePool(obs({ poolOpts: { liquidity: 5_000_000n * 10n ** 12n } }));
  const failed = a.gates.filter((g) => !g.passed).map((g) => g.name);
  assert.deepEqual(failed, ["depth under the cap"]);
});

test("the board ranks by trailing-hour fees and keeps rejects", () => {
  const board = buildBoard([
    obs({ address: "0xa", volume: { m5: 1_000, h1: 60_000, h6: 300_000, h24: 900_000 } }),
    obs({ address: "0xb", volume: { m5: 4_000, h1: 300_000, h6: 900_000, h24: 3_000_000 } }),
    // A hook is no longer a rejection, so this one fails for a real reason:
    // no LP fee reaches the position.
    obs({ address: "0xc", poolOpts: { fee: 0 } }),
  ]);

  assert.deepEqual(board.qualifying.map((a) => a.address), ["0xb", "0xa"]);
  assert.equal(board.rejected.length, 1, "a pool that stopped qualifying is kept, not dropped");
  assert.equal(board.rejected[0].address, "0xc");
});

test("every gate carries a reason whether it passed or not", () => {
  for (const a of [evaluatePool(obs()), evaluatePool(obs({ hasHook: true }))]) {
    for (const g of a.gates) {
      assert.ok(g.detail.length > 0, `${g.name} has no detail`);
    }
  }
});

// --- smart-LP tracker ------------------------------------------------------

const now = Date.UTC(2026, 0, 15);

/** n round trips for one wallet, each profitable by `edge`. */
function roundTrips(wallet, n, edge, startedAt = now - 5 * DAY) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const id = `${wallet}-${i}`;
    events.push({ kind: "add", wallet, positionId: id, value: 1_000, at: startedAt + i * HOUR });
    events.push({ kind: "remove", wallet, positionId: id, value: 1_000 + edge, at: startedAt + i * HOUR + HOUR / 2 });
  }
  return events;
}

test("a consistent winner is marked smart", () => {
  const scores = scoreWallets({
    events: roundTrips("0xwinner", 5, 40),
    openMarks: {},
    now,
  });

  const w = scores[0];
  assert.equal(w.wallet, "0xwinner");
  assert.equal(w.wins, 5);
  assert.equal(w.losses, 0);
  assert.equal(w.score, 200);
  assert.equal(w.smart, true);
});

test("one lucky exit is not enough", () => {
  const scores = scoreWallets({
    events: roundTrips("0xlucky", 1, 5_000),
    openMarks: {},
    now,
  });
  assert.equal(scores[0].smart, false, "a single win is not a record");
  assert.equal(scores[0].closedInWindow, 1);
});

test("a losing wallet is not smart however busy", () => {
  const scores = scoreWallets({
    events: roundTrips("0xloser", 8, -60),
    openMarks: {},
    now,
  });
  assert.equal(scores[0].wins, 0);
  assert.equal(scores[0].smart, false);
});

test("a wallet that only sits is tracked but not judged", () => {
  const scores = scoreWallets({
    events: [
      { kind: "add", wallet: "0xsitter", positionId: "p1", value: 50_000, at: now - 6 * DAY },
      { kind: "fee", wallet: "0xsitter", positionId: "p1", value: 900, at: now - 2 * DAY },
    ],
    openMarks: { p1: 51_000 },
    now,
  });

  const s = scores[0];
  assert.equal(s.closedInWindow, 0, "nothing closed, so nothing judged");
  assert.equal(s.smart, false, "sitting in a pool is not evidence of skill");
  assert.equal(s.openPositions, 1);
  // withdrawn 0 − deposited 50,000 + open 51,000 + fees 900
  assert.equal(s.score, 1_900);
});

test("a position opened before the window is not counted as a win", () => {
  const scores = scoreWallets({
    events: [
      // Opened outside the window; only the close lands inside it.
      { kind: "add", wallet: "0xold", positionId: "old", value: 1_000, at: now - 30 * DAY },
      { kind: "remove", wallet: "0xold", positionId: "old", value: 5_000, at: now - 1 * DAY },
      ...roundTrips("0xold", 1, 10),
    ],
    openMarks: {},
    now,
  });

  const s = scores[0];
  assert.equal(s.closedInWindow, 1, "only the in-window round trip is judged");
});

test("contracts are tagged bots and the desk never scores itself", () => {
  const scores = scoreWallets({
    events: [...roundTrips("0xbot", 5, 40), ...roundTrips("0xdesk", 5, 40)],
    openMarks: {},
    contracts: new Set(["0xbot"]),
    deskWallet: "0xdesk",
    now,
  });

  const bot = scores.find((s) => s.wallet === "0xbot");
  const desk = scores.find((s) => s.wallet === "0xdesk");

  assert.equal(bot.tag, "bot");
  assert.equal(bot.smart, false, "a contract is followed but not called smart");
  assert.equal(desk.tag, "desk");
  assert.equal(desk.smart, false, "the tracker must never score the desk");
});

test("events older than the window are ignored", () => {
  const scores = scoreWallets({
    events: roundTrips("0xstale", 5, 40, now - 30 * DAY),
    openMarks: {},
    now,
  });
  assert.equal(scores.length, 0, "nothing inside the window means nothing to score");
});

test("pool summary counts who is in and who just left", () => {
  const events = [
    ...roundTrips("0xsmart", 4, 50),
    { kind: "add", wallet: "0xsmart", positionId: "open", value: 8_000, at: now - 2 * HOUR },
    { kind: "add", wallet: "0xother", positionId: "o1", value: 3_000, at: now - 30 * 60 * 1000 },
    { kind: "remove", wallet: "0xother", positionId: "o1", value: 2_000, at: now - 10 * 60 * 1000 },
  ];
  const scores = scoreWallets({ events, openMarks: { open: 8_400 }, now });
  const summary = summarisePool(scores, events, now);

  assert.equal(summary.present, 1, "the smart wallet still holds a position");
  assert.equal(summary.presentValue, 8_400);
  assert.equal(summary.net, 0, "one winner, one loser");
});

test("tracker thresholds are configurable", () => {
  const events = roundTrips("0xw", 2, 30);
  assert.equal(scoreWallets({ events, openMarks: {}, now })[0].smart, false);

  const relaxed = scoreWallets(
    { events, openMarks: {}, now },
    { ...DEFAULT_TRACKER_CONFIG, minClosedPositions: 2 },
  );
  assert.equal(relaxed[0].smart, true);
});
