import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MemoryJournal,
  Unconfirmed,
  intentId,
  loadState,
  reconcile,
  replay,
  submit,
} from "../src/lib/keeper/registry.ts";
import { FileJournal } from "../src/lib/keeper/journal-file.ts";
import { DEFAULT_SWEEP, shouldRetire, shouldSweep } from "../src/lib/keeper/sweep.ts";
import { decide } from "../src/lib/keeper/decide.ts";
import { DEFAULT_TICK, tick } from "../src/lib/keeper/loop.ts";
import { netOverWindow, netReturn, seriesFrom } from "../src/lib/keeper/marks.ts";
import { DryRunSigner, checkSigner } from "../src/lib/keeper/signer.ts";
import { scan } from "../src/lib/sim/scanner.ts";

const RANGING = [100, 104, 97, 102, 96, 101, 99, 103, 98, 100, 102, 99];
const TRENDING = [100, 92, 84, 77, 70, 64, 58, 52, 47, 42, 38, 34];

const POOL = {
  name: "AMC/USDG", chain: "robinhood", kind: "band",
  volume: 60_000, volatility: 0.003, liquidity: 120_000, feePips: 3000,
  prices: RANGING,
};

const openIntent = (id = "open-1") => ({
  id, kind: "open", chain: "robinhood", pool: "AMC/USDG", venueKind: "band",
  capital: 10_000, lower: 90, upper: 110, reason: "test",
});

/* ---------------------------------------------------------------- registry */

test("a position is only believed once its intent settled", () => {
  const opened = openIntent();
  const half = replay([{ at: 1, kind: "intent", intent: opened }]);
  assert.equal(half.positions.length, 0);
  assert.equal(half.inFlight.length, 1);

  const whole = replay([
    { at: 1, kind: "intent", intent: opened },
    { at: 2, kind: "settled", intentId: "open-1", ok: true, handle: "nft-7", amount: 9_980 },
  ]);
  assert.equal(whole.inFlight.length, 0);
  assert.equal(whole.positions.length, 1);
  assert.equal(whole.positions[0].handle, "nft-7");
  // Capital is what actually reached the pool, not what was intended.
  assert.equal(whole.positions[0].capital, 9_980);
});

/**
 * The failure this whole module exists for: a keeper that dies between
 * submitting and recording must not come back believing it holds nothing.
 */
test("an intent journalled and never settled comes back as in flight", async () => {
  const journal = new MemoryJournal();
  await assert.rejects(
    submit(journal, openIntent(), async () => {
      throw new Unconfirmed("RPC timed out after broadcast");
    }).then((r) => {
      assert.equal(r.unresolved, true);
      throw new Error("marker");
    }),
    /marker/,
  );

  const state = await loadState(journal);
  assert.equal(state.inFlight.length, 1, "must not be written off as failed");
  assert.equal(state.positions.length, 0);
});

test("a call that failed to submit is closed out, not left in flight", async () => {
  const journal = new MemoryJournal();
  const result = await submit(journal, openIntent(), async () => {
    throw new Error("insufficient allowance");
  });
  assert.equal(result.ok, false);
  assert.equal(result.unresolved, undefined);
  const state = await loadState(journal);
  assert.equal(state.inFlight.length, 0);
  assert.equal(state.positions.length, 0);
});

test("the intent is written down before the call is made", async () => {
  const order = [];
  const journal = new MemoryJournal();
  const spy = {
    append: async (record) => { order.push(`journal:${record.kind}`); return journal.append(record); },
    read: () => journal.read(),
  };
  await submit(spy, openIntent(), async () => {
    order.push("execute");
    return { handle: "nft-7" };
  });
  assert.deepEqual(order, ["journal:intent", "execute", "journal:settled"]);
});

test("reconcile settles an in-flight intent from what the chain shows", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 1, kind: "intent", intent: openIntent() });

  const before = await loadState(journal);
  assert.equal(before.inFlight.length, 1);

  await reconcile(journal, before, async () => ({ found: "nft-9", amount: 10_000 }), 5);
  const after = await loadState(journal);
  assert.equal(after.inFlight.length, 0);
  assert.equal(after.positions[0].handle, "nft-9");
});

test("a reconciler that cannot tell stops the keeper rather than guessing", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 1, kind: "intent", intent: openIntent() });
  const state = await loadState(journal);
  await assert.rejects(
    reconcile(journal, state, async () => { throw new Error("node unreachable"); }),
    /node unreachable/,
  );
});

test("re-centring keeps the position's identity, and its age with it", async () => {
  const state = replay([
    { at: 1, kind: "intent", intent: openIntent() },
    { at: 2, kind: "settled", intentId: "open-1", ok: true, handle: "nft-7", amount: 10_000 },
    { at: 3, kind: "intent", intent: { id: "rb-1", kind: "rebalance", positionId: "open-1", lower: 95, upper: 115, reason: "drift" } },
    { at: 4, kind: "settled", intentId: "rb-1", ok: true, handle: "nft-8", amount: 9_900 },
  ]);
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].id, "open-1");
  assert.equal(state.positions[0].openedAt, 2, "age survives the move");
  assert.equal(state.positions[0].lower, 95);
  assert.equal(state.positions[0].handle, "nft-8");
});

test("ids are unique within a millisecond", () => {
  const ids = new Set(Array.from({ length: 500 }, () => intentId("open", 1_000)));
  assert.equal(ids.size, 500);
});

/* ----------------------------------------------------------------- journal */

test("a half-written last line is dropped, not fatal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "resident-"));
  const path = join(dir, "journal.ndjson");
  const good = JSON.stringify({ at: 1, kind: "intent", intent: openIntent() });
  await writeFile(path, good + "\n" + '{"at":2,"kind":"sett', "utf8");
  const records = await new FileJournal(path).read();
  assert.equal(records.length, 1);
});

test("a corrupt line in the middle refuses to replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "resident-"));
  const path = join(dir, "journal.ndjson");
  const good = JSON.stringify({ at: 1, kind: "heartbeat", ok: true, note: "" });
  await writeFile(path, good + "\nnot json\n" + good + "\n", "utf8");
  await assert.rejects(new FileJournal(path).read(), /line 2 is not valid JSON/);
});

test("a journal that does not exist yet reads as empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "resident-"));
  assert.deepEqual(await new FileJournal(join(dir, "none.ndjson")).read(), []);
});

/* ------------------------------------------------------------------- sweep */

test("the time rule never sweeps fees that do not clear gas", () => {
  const verdict = shouldSweep(4, 999, 2, DEFAULT_SWEEP);
  assert.equal(verdict.sweep, false);
  assert.match(verdict.reason, /does not clear/);
});

test("a run of bad readings retires, a single one does not", () => {
  const rates = Array(20).fill(0.0001);
  assert.equal(shouldRetire(rates).retire, false);
  rates[19] = -0.001;
  assert.equal(shouldRetire(rates).retire, false, "one bad reading is noise");
  assert.equal(shouldRetire(Array(20).fill(-0.001)).retire, true);
});

test("too little history never retires, whatever it says", () => {
  assert.equal(shouldRetire(Array(3).fill(-1)).retire, false);
});

/* ------------------------------------------------------------------ decide */

const held = (over = {}) => ({
  id: "p1", chain: "robinhood", pool: "AMC/USDG", kind: "band", handle: "nft-7",
  capital: 10_000, lower: 90, upper: 110, openedAt: 0, feesSwept: 0, lastSweptAt: 0,
  ...over,
});

const observed = (over = {}) => ({
  positionId: "p1", currentRate: 0.00002, feesUnclaimed: 10, recentRates: [0.00002],
  value: 10_000, price: 100, freshLower: 95, freshUpper: 105,
  ageIntervals: 100, intervalsSinceSweep: 2,
  ...over,
});

const input = (over = {}) => ({
  state: { positions: [], inFlight: [], sweptTotal: 0, lastRecordAt: 0, lastHealthyAt: 0 },
  scan: scan([POOL], null, 20_000, {}),
  observations: [],
  idleCapital: 0, unbookedProfit: 0, unbookedLoss: 0, owed: 0, distributeAt: 500,
  now: 1_000,
  ...over,
});

test("an unreconciled intent stops the keeper deciding anything", () => {
  const { intents, passed } = decide(input({
    state: { positions: [], inFlight: [openIntent()], sweptTotal: 0, lastRecordAt: 0, lastHealthyAt: 0 },
    idleCapital: 50_000,
  }));
  assert.equal(intents.length, 0);
  assert.match(passed[0].reason, /in flight/);
});

test("a retired position is not also swept or re-centred in the same tick", () => {
  const { intents } = decide(input({
    state: { positions: [held()], inFlight: [], sweptTotal: 0, lastRecordAt: 0, lastHealthyAt: 0 },
    observations: [observed({ recentRates: Array(20).fill(-0.001), feesUnclaimed: 5_000 })],
  }));
  const kinds = intents.map((i) => i.kind);
  assert.ok(kinds.includes("close"));
  assert.equal(kinds.filter((k) => k === "sweep").length, 0);
  assert.equal(kinds.filter((k) => k === "rebalance").length, 0);
});

test("capital is deployed only into a pool that ranges", () => {
  const trending = scan([{ ...POOL, prices: TRENDING }], null, 20_000, {});
  const { intents, passed } = decide(input({ scan: trending, idleCapital: 50_000 }));
  assert.equal(intents.filter((i) => i.kind === "open").length, 0);
  assert.ok(passed.some((p) => p.subject === "deploy"));
});

test("the reserve is kept back so the desk can pay to close a position", () => {
  const { intents, passed } = decide(input({ idleCapital: 300 }));
  assert.equal(intents.filter((i) => i.kind === "open").length, 0);
  assert.ok(passed.some((p) => /reserve/.test(p.reason)));

  const funded = decide(input({ idleCapital: 50_000 }));
  const open = funded.intents.find((i) => i.kind === "open");
  assert.ok(open, "with real capital it opens");
  assert.equal(open.pool, "AMC/USDG");
});

test("the same pool is never opened twice", () => {
  const { intents } = decide(input({
    state: { positions: [held()], inFlight: [], sweptTotal: 0, lastRecordAt: 0, lastHealthyAt: 0 },
    observations: [observed()],
    idleCapital: 50_000,
  }));
  assert.equal(intents.filter((i) => i.kind === "open").length, 0);
});

test("booking realised profit is not conditional on anything", () => {
  const { intents } = decide(input({ unbookedProfit: 40 }));
  const record = intents.find((i) => i.kind === "record");
  assert.ok(record);
  assert.equal(record.realized, 40);
});

test("holders are paid once what is owed clears the threshold", () => {
  assert.ok(decide(input({ owed: 600 })).intents.some((i) => i.kind === "distribute"));
  const short = decide(input({ owed: 100 }));
  assert.equal(short.intents.some((i) => i.kind === "distribute"), false);
  assert.ok(short.passed.some((p) => p.subject === "distribute"));
});

test("bridging is decided last, after everything local", () => {
  const here = { name: "elsewhere", chain: "solana", netRate: 0 };
  const withMove = scan([POOL], here, 20_000, {
    robinhood: { feeFraction: 0.0005, fixedCost: 1, latencyIntervals: 1 },
  });
  const { intents } = decide(input({ scan: withMove, idleCapital: 50_000 }));
  const kinds = intents.map((i) => i.kind);
  if (kinds.includes("bridge")) {
    assert.ok(kinds.indexOf("bridge") > kinds.indexOf("open"));
  }
});

/* -------------------------------------------------------------------- loop */

function fakeDeps(over = {}) {
  return {
    signer: new DryRunSigner(),
    observe: async () => ({
      pools: [POOL], positions: [], current: null, idleCapital: 50_000,
      unbookedProfit: 0, unbookedLoss: 0, owed: 0, bridges: {},
      vault: { owner: "0xowner", keeper: "0xkeeper" },
    }),
    execute: async () => ({ handle: "nft-1", amount: 10_000 }),
    reconcile: async () => ({ found: null }),
    ...over,
  };
}

test("a tick that cannot read halts and says so, instead of throwing", async () => {
  const journal = new MemoryJournal();
  const report = await tick(
    fakeDeps({ observe: async () => { throw new Error("rpc down"); } }),
    journal, DEFAULT_TICK, () => 1_000,
  );
  assert.match(report.halted, /rpc down/);
  const records = await journal.read();
  assert.equal(records.at(-1).kind, "heartbeat");
  assert.equal(records.at(-1).ok, false);
});

test("a tick opens a position and the journal shows it afterwards", async () => {
  const journal = new MemoryJournal();
  const report = await tick(fakeDeps(), journal, DEFAULT_TICK, () => 1_000);
  assert.equal(report.halted, null);
  assert.ok(report.intents.some((i) => i.kind === "open"));
  const state = await loadState(journal);
  assert.equal(state.positions.length, 1);
});

test("an unresolved call stops the rest of the tick", async () => {
  const journal = new MemoryJournal();
  const report = await tick(
    fakeDeps({
      observe: async () => ({
        pools: [POOL], positions: [], current: null, idleCapital: 50_000,
        unbookedProfit: 25, unbookedLoss: 0, owed: 900, bridges: {},
        vault: { owner: "0xowner", keeper: "0xkeeper" },
      }),
      execute: async () => { throw new Unconfirmed("broadcast, no receipt"); },
    }),
    journal, DEFAULT_TICK, () => 1_000,
  );
  assert.match(report.halted, /unresolved/);
  assert.equal(report.results.length, 1, "nothing after the unresolved call ran");
  const state = await loadState(journal);
  assert.equal(state.inFlight.length, 1);
});

test("the next tick reconciles before deciding anything new", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 1, kind: "intent", intent: openIntent() });
  const report = await tick(
    fakeDeps({ reconcile: async () => ({ found: "nft-live", amount: 10_000 }) }),
    journal, DEFAULT_TICK, () => 2_000,
  );
  assert.equal(report.reconciled, 1);
  const state = await loadState(journal);
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].handle, "nft-live");
});

test("a dry run signs nothing and still journals what it would have done", async () => {
  const journal = new MemoryJournal();
  const deps = fakeDeps();
  await tick(deps, journal, DEFAULT_TICK, () => 1_000);
  assert.equal(deps.signer.dryRun, true);
  assert.equal(deps.signer.calls.length, 0, "the executor is what signs, not the tick");
  assert.ok((await journal.read()).some((r) => r.kind === "intent"));
});

/* ------------------------------------------------------------------ signer */

test("the keeper refuses to run as the vault owner", () => {
  const asOwner = checkSigner("0xOWNER", { owner: "0xowner", keeper: "0xowner" });
  assert.equal(asOwner.ok, false);
  assert.ok(asOwner.problems.some((p) => /vault owner/.test(p)));
  assert.ok(asOwner.problems.some((p) => /owner and keeper are the same/.test(p)));

  // A signer that is neither is caught too: every call would revert.
  const stranger = checkSigner("0xstranger", { owner: "0xowner", keeper: "0xkeeper" });
  assert.equal(stranger.ok, false);
  assert.ok(stranger.problems.some((p) => /is not the vault keeper/.test(p)));

  // Address comparison is case-insensitive, or a checksummed address fails.
  assert.ok(checkSigner("0xkeeper", { owner: "0xowner", keeper: "0xKEEPER" }).ok);
});

/* ------------------------------------------------------------------- marks */

const MINUTE = 60_000;

test("net is fees less what the principal lost, not fees alone", () => {
  const records = [
    { at: 0, kind: "mark", positionId: "p1", value: 10_000, feesUnclaimed: 0, price: 100 },
    { at: 6 * 60 * MINUTE, kind: "mark", positionId: "p1", value: 9_700, feesUnclaimed: 120, price: 92 },
  ];
  const series = seriesFrom(records).get("p1");
  const net = netOverWindow(series, 6 * 60 * MINUTE, 6 * 60 * MINUTE);
  assert.equal(net.fees, 120);
  assert.equal(net.principalChange, -300);
  assert.equal(net.net, -180, "a position up on fees and down on net");
  assert.equal(netReturn(net), -0.018);
});

test("swept fees are counted, not lost when feesUnclaimed resets", () => {
  const records = [
    { at: 0, kind: "mark", positionId: "p1", value: 10_000, feesUnclaimed: 0, price: 100 },
    { at: MINUTE, kind: "intent", intent: { id: "s1", kind: "sweep", positionId: "p1", reason: "" } },
    { at: MINUTE, kind: "settled", intentId: "s1", ok: true, amount: 200 },
    { at: 2 * MINUTE, kind: "mark", positionId: "p1", value: 10_000, feesUnclaimed: 0, price: 100 },
  ];
  const series = seriesFrom(records).get("p1");
  const net = netOverWindow(series, 2 * MINUTE, 2 * MINUTE);
  assert.equal(net.fees, 200, "a sweep is income, not a disappearance");
  assert.equal(net.net, 200);
});

test("a window the history does not reach is null, never a shorter one", () => {
  const records = [
    { at: 100 * MINUTE, kind: "mark", positionId: "p1", value: 10_000, feesUnclaimed: 0, price: 100 },
    { at: 140 * MINUTE, kind: "mark", positionId: "p1", value: 10_100, feesUnclaimed: 5, price: 101 },
  ];
  const series = seriesFrom(records).get("p1");
  assert.equal(netOverWindow(series, 6 * 60 * MINUTE, 140 * MINUTE), null);
  assert.ok(netOverWindow(series, 40 * MINUTE, 140 * MINUTE));
});

test("one mark is not a series", () => {
  const series = seriesFrom([
    { at: 0, kind: "mark", positionId: "p1", value: 10_000, feesUnclaimed: 0, price: 100 },
  ]).get("p1");
  assert.equal(netOverWindow(series, MINUTE, MINUTE), null);
});

/* ------------------------------------------------------------------ ledger */

const { ledgerFrom, ledgerTotals } = await import("../src/lib/keeper/ledger.ts");

const lifecycle = [
  { at: 10, kind: "intent", intent: openIntent("o1") },
  { at: 11, kind: "settled", intentId: "o1", ok: true, handle: "nft-1", amount: 10_000, txHash: "0xopen" },
  { at: 20, kind: "intent", intent: { id: "s1", kind: "sweep", positionId: "o1", reason: "" } },
  { at: 21, kind: "settled", intentId: "s1", ok: true, amount: 120, txHash: "0xsweep" },
  { at: 30, kind: "mark", positionId: "o1", value: 9_800, feesUnclaimed: 30, price: 98 },
  { at: 40, kind: "intent", intent: { id: "c1", kind: "close", positionId: "o1", reason: "" } },
  { at: 41, kind: "settled", intentId: "c1", ok: true, amount: 9_850, txHash: "0xclose" },
];

test("a closed position's result is arithmetic, not an estimate", () => {
  const [entry] = ledgerFrom(lifecycle);
  assert.equal(entry.capitalIn, 10_000);
  assert.equal(entry.feesSwept, 120);
  assert.equal(entry.proceedsOut, 9_850);
  // 9,850 back plus 120 of fees against 10,000 committed.
  assert.equal(entry.realised, -30);
  assert.equal(entry.unrealised, null, "closed positions have no mark");
  assert.deepEqual(entry.txHashes, ["0xopen", "0xsweep", "0xclose"]);
});

test("an open position is marked, and never counted as realised", () => {
  const [entry] = ledgerFrom(lifecycle.slice(0, 5));
  assert.equal(entry.realised, null);
  assert.equal(entry.unrealised, 9_800 + 30 + 120 - 10_000);
  assert.equal(entry.closedAt, null);
});

test("realised and unrealised are never added together for you", () => {
  const totals = ledgerTotals(ledgerFrom(lifecycle));
  assert.equal(totals.positions, 1);
  assert.equal(totals.closed, 1);
  assert.equal(totals.realised, -30);
  assert.equal(totals.unrealised, 0);
  assert.equal(totals.losers, 1, "a loss is in the ledger like anything else");
  assert.equal(totals.winners, 0);
});

test("re-centring is counted, and the ledger follows the capital", () => {
  const withMove = [
    ...lifecycle.slice(0, 4),
    { at: 25, kind: "intent", intent: { id: "r1", kind: "rebalance", positionId: "o1", lower: 95, upper: 115, reason: "" } },
    { at: 26, kind: "settled", intentId: "r1", ok: true, handle: "nft-2", amount: 9_900, txHash: "0xrb" },
  ];
  const [entry] = ledgerFrom(withMove);
  assert.equal(entry.rebalances, 1);
  assert.equal(entry.capitalIn, 9_900);
});

test("a position nothing settled for never enters the ledger", () => {
  assert.deepEqual(ledgerFrom([{ at: 1, kind: "intent", intent: openIntent("o9") }]), []);
});
