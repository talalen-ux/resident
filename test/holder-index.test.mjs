/**
 * Keeping the holder list current without replaying history every cycle.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { HolderIndex } from "../src/lib/keeper/holder-index.ts";

const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (a) => `0x${"0".repeat(24)}${a.slice(2)}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const move = (from, to, value) => ({
  topics: [TRANSFER, topic(from), topic(to)],
  data: `0x${value.toString(16).padStart(64, "0")}`,
});

/** A fake chain: logs keyed by the block they sit in. */
const chain = (byBlock) => {
  const calls = [];
  const read = async ({ fromBlock, toBlock }) => {
    calls.push([fromBlock, toBlock]);
    const out = [];
    for (const [block, logs] of Object.entries(byBlock)) {
      if (Number(block) >= fromBlock && Number(block) <= toBlock) out.push(...logs);
    }
    return out;
  };
  return { read, calls };
};

test("a mint then a transfer leaves the right balances", async () => {
  const { read } = chain({ 5: [move(ZERO, A, 1000n)], 9: [move(A, B, 400n)] });
  const index = new HolderIndex(read, "0xtoken");
  await index.refresh(10);
  const balances = index.snapshot();
  assert.equal(balances.get(A), 600n);
  assert.equal(balances.get(B), 400n);
  assert.equal(index.syncedTo, 10);
});

test("a refresh reads only what is new", async () => {
  const { read, calls } = chain({ 5: [move(ZERO, A, 1000n)], 15: [move(A, B, 100n)] });
  const index = new HolderIndex(read, "0xtoken", { maxBlockSpan: 100 });
  await index.refresh(10);
  const first = calls.length;
  await index.refresh(20);

  // The second pass must start after the first ended. Re-reading block 5 would
  // apply the mint twice and double the supply.
  assert.equal(calls[first][0], 11);
  assert.equal(index.snapshot().get(A), 900n);
  assert.equal(index.snapshot().get(B), 100n);
});

test("the range is chunked to what the node will accept", async () => {
  const { read, calls } = chain({});
  const index = new HolderIndex(read, "0xtoken", { maxBlockSpan: 1_000 });
  await index.refresh(2_500);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], [0, 999]);
  assert.deepEqual(calls[1], [1000, 1999]);
  assert.deepEqual(calls[2], [2000, 2500]);
});

test("a rebuild starts at the deployment block, not at zero", async () => {
  const { read, calls } = chain({});
  const index = new HolderIndex(read, "0xtoken", { deployedAt: 5_000, maxBlockSpan: 1_000 });
  await index.refresh(5_500);
  // Scanning from genesis on a chain with history is minutes of eth_getLogs
  // for blocks that cannot contain a transfer of a token that did not exist.
  assert.equal(calls[0][0], 5_001);
});

test("a chunk that fails leaves the index correct as far as it read", async () => {
  let call = 0;
  const read = async ({ fromBlock }) => {
    call++;
    if (call === 2) throw new Error("query returned more than 10000 results");
    return fromBlock === 0 ? [move(ZERO, A, 1000n)] : [];
  };
  const index = new HolderIndex(read, "0xtoken", { maxBlockSpan: 100 });
  await assert.rejects(() => index.refresh(500));

  // The first chunk landed and must not be lost: the next refresh continues
  // from there rather than starting over.
  assert.equal(index.snapshot().get(A), 1000n);
  assert.equal(index.syncedTo, 99);
});

test("a snapshot cannot be used to mutate the index", async () => {
  const { read } = chain({ 1: [move(ZERO, A, 500n)] });
  const index = new HolderIndex(read, "0xtoken");
  await index.refresh(2);
  const snap = index.snapshot();
  snap.set(B, 999n);
  assert.equal(index.snapshot().has(B), false);
});

test("refreshing to a head already read does nothing", async () => {
  const { read, calls } = chain({ 1: [move(ZERO, A, 500n)] });
  const index = new HolderIndex(read, "0xtoken");
  await index.refresh(10);
  const before = calls.length;
  await index.refresh(10);
  assert.equal(calls.length, before);
});
