/**
 * When a distribution is worth making, and who it reaches.
 *
 * Both failures these guard against are invisible in a small test and fatal at
 * scale: a cadence that costs more in gas than it pays out, and a recipient cap
 * that pays the same names forever.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DISTRIBUTION,
  planDistribution,
  rotate,
} from "../src/lib/keeper/distribution.ts";
import { splitPro } from "../src/lib/keeper/holders.ts";

// Quote units per gas unit. 1 gwei with ether at $3,000.
const ONE_GWEI = 1e-9 * 3000;

test("a distribution too small to clear the per-holder floor waits", () => {
  // $300 across 5,000 holders is six cents each, and six cents costs more than
  // six cents to send.
  const plan = planDistribution({ owed: 300, eligible: 5_000, gasPrice: ONE_GWEI });
  assert.equal(plan.distribute, false);
  assert.match(plan.reason, /under the 1 floor/);
  // Waiting must be framed as costless, because it is: the entitlement stays
  // in the vault's ledger.
  assert.match(plan.reason, /nothing is forfeited/);
});

test("the same amount to few enough holders goes out", () => {
  const plan = planDistribution({ owed: 300, eligible: 50, gasPrice: ONE_GWEI });
  assert.equal(plan.distribute, true);
  assert.equal(plan.recipients, 50);
  assert.equal(plan.amount, 300);
});

test("gas above its share of the payout blocks the distribution", () => {
  // 500 holders at 5 gwei is about $265 of gas. On a $1,000 payout that is
  // 26%, which is not a payment, it is a fee.
  const plan = planDistribution(
    { owed: 1_000, eligible: 500, gasPrice: 5e-9 * 3000 },
    DEFAULT_DISTRIBUTION,
  );
  assert.equal(plan.distribute, false);
  assert.match(plan.reason, /The limit is 2%/);
  // It still reports what it would have cost, so an operator can see why.
  assert.ok(plan.gasCost > 0);
});

test("the same payout at a subsidised gas price goes out", () => {
  const plan = planDistribution(
    { owed: 1_000, eligible: 500, gasPrice: 0.05e-9 * 3000 },
    DEFAULT_DISTRIBUTION,
  );
  assert.equal(plan.distribute, true);
});

test("nothing owed and nobody to pay are separate refusals", () => {
  assert.match(planDistribution({ owed: 0, eligible: 100, gasPrice: ONE_GWEI }).reason, /nothing is owed/);
  assert.match(planDistribution({ owed: 100, eligible: 0, gasPrice: ONE_GWEI }).reason, /no eligible holders/);
});

test("the recipient cap holds even when everyone clears the floor", () => {
  const plan = planDistribution(
    { owed: 1_000_000, eligible: 5_000, gasPrice: 0.01e-9 * 3000 },
    DEFAULT_DISTRIBUTION,
  );
  // A call that only fits in an empty block does not land in a busy one.
  assert.equal(plan.recipients, DEFAULT_DISTRIBUTION.maxRecipients);
});

/* ------------------------------------------------------------- rotation */

test("rotation reaches every holder within a bounded number of cycles", () => {
  const items = Array.from({ length: 1_000 }, (_, i) => i);
  const seen = new Set();
  const groups = Math.ceil(1_000 / 400);
  for (let cycle = 0; cycle < groups; cycle++) {
    for (const item of rotate(items, 400, cycle)) seen.add(item);
  }
  // Not "most of them eventually". All of them, within ceil(1000/400) cycles.
  assert.equal(seen.size, 1_000);
});

test("a list that fits is never rotated", () => {
  const items = [1, 2, 3];
  assert.deepEqual(rotate(items, 10, 7), items);
});

test("the tail is paid, which the balance-sorted version never did", () => {
  const balances = new Map();
  for (let i = 0; i < 600; i++) {
    balances.set(
      "0x" + String(i).padStart(40, "0"),
      BigInt(Math.floor(1e6 * Math.pow(0.99, i))),
    );
  }

  const reached = new Set();
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const a of splitPro(balances, 300_000_000n, { maxRecipients: 400, cycle }).allocations) {
      reached.add(a.recipient);
    }
  }
  // Two cycles at a 400 cap covers 600 holders. Sorting by balance instead
  // reached exactly the same 400 both times and never the other 200.
  assert.equal(reached.size, 600);
});

test("pro-rata is computed over every holder, not over the rotation", () => {
  const balances = new Map();
  for (let i = 0; i < 4; i++) {
    balances.set("0x" + String(i).padStart(40, "0"), 100n);
  }
  const first = splitPro(balances, 1000n, { maxRecipients: 2, cycle: 0 });
  const second = splitPro(balances, 1000n, { maxRecipients: 2, cycle: 1 });

  // Each holder is a quarter of supply, so each gets 250 whichever rotation
  // pays them. Dividing by the rotation would pay 500 each and the vault would
  // reject the second call for exceeding what it owes.
  assert.deepEqual(first.allocations.map((a) => a.amount), [250n, 250n]);
  assert.deepEqual(second.allocations.map((a) => a.amount), [250n, 250n]);
  assert.equal(first.total + second.total, 1000n);
});
