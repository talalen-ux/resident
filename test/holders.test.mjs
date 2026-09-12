/**
 * Who gets paid, and how much.
 *
 * The vault refuses to pay more than it owes, so every rounding decision here
 * is one-sided: rounding up costs the whole cycle, rounding down costs dust
 * that rolls forward. The tests are mostly about that asymmetry and about
 * addresses that hold the token without being holders.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { balancesFrom, splitPro } from "../src/lib/keeper/holders.ts";

const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";

const transfer = (from, to, value) => ({
  topics: [TRANSFER, topic(from), topic(to)],
  data: `0x${value.toString(16).padStart(64, "0")}`,
});

test("a mint is a transfer from zero and must be counted", () => {
  // Skipping mints leaves every balance short by exactly what was minted.
  const balances = balancesFrom([transfer(ZERO, A, 1000n)]);
  assert.equal(balances.get(A), 1000n);
  assert.equal(balances.has(ZERO), false);
});

test("transfers move balances and a burn removes them", () => {
  const balances = balancesFrom([
    transfer(ZERO, A, 1000n),
    transfer(A, B, 400n),
    transfer(B, ZERO, 100n),
  ]);
  assert.equal(balances.get(A), 600n);
  assert.equal(balances.get(B), 300n);
});

test("an address emptied out drops off the list entirely", () => {
  const balances = balancesFrom([transfer(ZERO, A, 100n), transfer(A, B, 100n)]);
  // Not a zero entry. A zero-balance holder in the list is a recipient the
  // split has to filter out later, and one it might not.
  assert.equal(balances.has(A), false);
  assert.equal(balances.get(B), 100n);
});

test("logs that are not Transfers are ignored", () => {
  const balances = balancesFrom([
    { topics: ["0xdeadbeef", topic(A), topic(B)], data: "0x01" },
    // A Transfer-shaped log with too few topics is an ERC721-style or a
    // malformed event, not a value movement we can read.
    { topics: [TRANSFER, topic(A)], data: "0x01" },
    transfer(ZERO, A, 50n),
  ]);
  assert.equal(balances.size, 1);
  assert.equal(balances.get(A), 50n);
});

test("the split is pro rata and never exceeds the amount", () => {
  const balances = new Map([[A, 60n], [B, 40n]]);
  const { allocations, total } = splitPro(balances, 1000n);
  assert.deepEqual(
    allocations.map((a) => [a.recipient, a.amount]),
    [[A, 600n], [B, 400n]],
  );
  assert.equal(total, 1000n);
});

test("rounding is always down, so the sum can never exceed what is owed", () => {
  // Three equal holders and an amount that does not divide. Rounding up would
  // make the total 1001 against 1000 owed, and the vault reverts the lot.
  const balances = new Map([[A, 1n], [B, 1n], [C, 1n]]);
  const { allocations, total } = splitPro(balances, 1000n);
  assert.equal(allocations.length, 3);
  assert.ok(total <= 1000n, `${total} must not exceed 1000`);
  assert.equal(total, 999n);
});

test("excluded addresses hold the token but are not holders", () => {
  const vault = A;
  const balances = new Map([[A, 500n], [B, 500n]]);
  const { allocations, total } = splitPro(balances, 1000n, { exclude: [vault] });
  // Paying the vault its own distribution books the payment and moves nothing.
  assert.deepEqual(allocations.map((a) => a.recipient), [B]);
  assert.equal(total, 1000n);
});

test("exclusion is case-insensitive, because addresses arrive both ways", () => {
  const balances = new Map([[A, 500n], [B, 500n]]);
  const { allocations } = splitPro(balances, 1000n, { exclude: [A.toUpperCase()] });
  assert.deepEqual(allocations.map((a) => a.recipient), [B]);
});

test("dust is skipped and stays owed rather than being paid at a loss", () => {
  const balances = new Map([[A, 999_999n], [B, 1n]]);
  const { allocations, total, skipped } = splitPro(balances, 1_000_000n, { dust: 100n });
  assert.equal(allocations.length, 1);
  assert.equal(skipped, 1);
  // What was skipped is simply not paid. It remains owed by the vault and
  // rolls into the next cycle.
  assert.ok(total < 1_000_000n);
});

test("the list is truncated largest-first, so the dropped holders are owed least", () => {
  const balances = new Map([[A, 100n], [B, 50n], [C, 10n]]);
  const { allocations, skipped } = splitPro(balances, 1600n, { maxRecipients: 2 });
  assert.deepEqual(allocations.map((a) => a.recipient), [A, B]);
  assert.equal(skipped, 1);
});

test("nothing to split, or nobody to split it between, pays nobody", () => {
  assert.deepEqual(splitPro(new Map([[A, 100n]]), 0n).allocations, []);
  assert.deepEqual(splitPro(new Map(), 1000n).allocations, []);
  // Every holder excluded is the same as no holders, and must not divide by zero.
  const all = splitPro(new Map([[A, 100n]]), 1000n, { exclude: [A] });
  assert.deepEqual(all.allocations, []);
  assert.equal(all.total, 0n);
});

test("a negative amount pays nobody rather than inverting the split", () => {
  assert.deepEqual(splitPro(new Map([[A, 100n]]), -5n).allocations, []);
});
