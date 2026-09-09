/**
 * Every number on the page has to be the number in the code.
 *
 * Published parameters are the thing that separates this from a marketing
 * site, and they rot silently: a constant gets tuned, the page keeps quoting
 * the old value, and the claim that the thresholds are public quietly becomes
 * false. This test binds each documented row to the constant it quotes, so
 * changing one without the other fails the build.
 *
 * A row here that no longer matches is not a test to update. It is either a
 * documentation change that was forgotten or a constant that moved without
 * anyone deciding it should.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PARAMETERS } from "../src/content/docs.ts";
import { DEFAULT_ALERT_CONFIG } from "../src/lib/sim/opportunity.ts";
import {
  DEFAULT_EXIT_CONFIG,
  DEFAULT_WIDTH_CONFIG,
} from "../src/lib/sim/strategy.ts";
import { DEFAULT_SIZING } from "../src/lib/sim/dlmm.ts";
import { DEFAULT_ALLOCATION } from "../src/lib/sim/allocate.ts";
import {
  DEFAULT_REBALANCE,
  RANGING_THRESHOLDS,
} from "../src/lib/sim/rebalance.ts";
import { DEFAULT_SWEEP, DEFAULT_RETIRE } from "../src/lib/keeper/sweep.ts";
import { DEFAULT_DECIDE } from "../src/lib/keeper/decide.ts";
import { DEFAULT_TICK } from "../src/lib/keeper/loop.ts";

/** meaning → the string the constant should render as. */
const BINDINGS = {
  "Narrowest and widest it can go": () =>
    `${DEFAULT_WIDTH_CONFIG.minWidth * 100}% to ${DEFAULT_WIDTH_CONFIG.maxWidth * 100}%`,
  "Minimum traded in the last hour": () =>
    `$${DEFAULT_ALERT_CONFIG.minVolume1h.toLocaleString("en-US")}`,
  "Maximum money already near the price": () =>
    `$${DEFAULT_ALERT_CONFIG.maxBandLiquidity.toLocaleString("en-US")}`,
  "Size used to rank the board": () =>
    `$${DEFAULT_ALERT_CONFIG.bandSize.toLocaleString("en-US")}`,
  "Must still be within this much of the 24h high": () =>
    `${Math.round((1 - DEFAULT_ALERT_CONFIG.minPeakFraction) * 100)}%`,
  "Minimum age of the pool": () => `${DEFAULT_ALERT_CONFIG.minAgeMinutes} minutes`,
  "How long out of range before it is moved": () =>
    `${DEFAULT_EXIT_CONFIG.rebalanceAfter} minutes`,
  "How long unprofitable before the pool is dropped": () =>
    `${DEFAULT_EXIT_CONFIG.staleAfter / 60} hours`,
  "Loss that closes a position": () =>
    `${DEFAULT_EXIT_CONFIG.maxNetLossFraction * 100}% of what went in`,
  "Minimum before a payout runs": () => `$${DEFAULT_TICK.distributeAt} owed`,
  "Fees are collected once they reach": () => `$${DEFAULT_SWEEP.minAmount}`,
  "Or after this long uncollected": () => `${DEFAULT_SWEEP.maxIntervals} minutes`,
  "Readings under the floor before a position is retired": () =>
    `${DEFAULT_RETIRE.runLength}`,
  "Held back so the protocol can always pay for gas": () =>
    `$${DEFAULT_DECIDE.reserve}`,
  "Smallest position on a small-cap pool": () => `$${DEFAULT_SIZING.minCapital}`,
  "Widest a Solana position is spread": () => `${DEFAULT_SIZING.maxBinCount} bins`,
  "A cross-chain edge is assumed to last": () =>
    `${DEFAULT_ALLOCATION.edgeHalfLife / 60} hours`,
  "A cross-chain move must be worth": () =>
    `${DEFAULT_ALLOCATION.requiredMargin}x its cost`,
  "Smallest amount worth moving between chains": () =>
    `$${DEFAULT_ALLOCATION.minCapital.toLocaleString("en-US")}`,
  "Re-centring must be worth": () => `${DEFAULT_REBALANCE.requiredMargin}x its cost`,
  "A pool counts as ranging if it held": () =>
    `±${RANGING_THRESHOLDS.bandHalfWidth * 100}%`,
  "for at least this much of its history": () =>
    `${RANGING_THRESHOLDS.containment * 100}%`,
};

for (const [meaning, expected] of Object.entries(BINDINGS)) {
  test(`the page's "${meaning}" matches the code`, () => {
    const row = PARAMETERS.find((p) => p.meaning === meaning);
    assert.ok(row, `no published row for "${meaning}" — was it renamed?`);
    assert.equal(row.value, expected());
  });
}

/**
 * The check that keeps the check honest: a new published parameter has to be
 * bound to something, or the table grows rows nothing verifies.
 */
test("every published parameter is either bound to a constant or explicitly prose", () => {
  const PROSE = new Set([
    "How wide the range is",
    "Time the price stays in range, at that width",
    "Holders' share of profit",
  ]);
  const unbound = PARAMETERS.filter(
    (p) => !(p.meaning in BINDINGS) && !PROSE.has(p.meaning),
  );
  assert.deepEqual(
    unbound.map((p) => p.meaning),
    [],
    "add a binding in this file, or list it as prose with a reason",
  );
});

/** The split is in the contract, so it is checked against the contract. */
test("the holders' share on the page is the share the contract enforces", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("contracts/ResidentVault.sol", "utf8");
  // Solidity allows underscores in numeric literals, so 1_500 has to parse.
  const match = source.match(/HOLDER_BPS\s*=\s*([\d_]+)/);
  assert.ok(match, "HOLDER_BPS is no longer a literal in the contract");
  const share = Number(match[1].replace(/_/g, "")) / 100;
  const row = PARAMETERS.find((p) => p.meaning === "Holders' share of profit");
  assert.equal(row.value, `${share}%`);
});
