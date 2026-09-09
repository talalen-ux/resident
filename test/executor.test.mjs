/**
 * Robinhood Chain execution.
 *
 * None of this can be run against a chain from here, so the encoding is
 * checked by decoding it back with an independent decoder, and the control flow
 * is checked against a fake chain that can be made to lose a receipt, revert, or
 * succeed without emitting the log the executor needs.
 *
 * The assertions that matter most are the ones about NOT recording something as
 * a failure. An ordinary error is written down and stepped past; Unconfirmed
 * leaves the intent in flight so the next tick has to go and look. Getting that
 * backwards opens the same position twice.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";

import {
  ACTIONS,
  MODIFY_LIQUIDITIES_SELECTOR,
  planClose,
  planCollect,
  planMint,
  planRecentre,
} from "../src/lib/keeper/v4-actions.ts";
import {
  approvalsFor,
  bandTicks,
  makeV4Executor,
  sizeMint,
  tokenIdFromLogs,
  viaVault,
} from "../src/lib/keeper/executor-v4.ts";
import { Unconfirmed } from "../src/lib/keeper/registry.ts";
import { DryRunSigner } from "../src/lib/keeper/signer.ts";
import {
  alignTick,
  amount0Delta,
  amount1Delta,
  liquidityForAmounts,
  sqrtPriceAtTick,
  tickAtPrice,
} from "../src/lib/sim/v3.ts";
import { buildPool } from "../src/lib/sim/pools.ts";

const abi = AbiCoder.defaultAbiCoder();
const ADDR = (n) => "0x" + String(n).repeat(2).padStart(40, "0");
const VAULT = ADDR(3);
const PM = ADDR(4);

const KEY = {
  currency0: ADDR(1),
  currency1: ADDR(2),
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x" + "0".repeat(40),
};

const POOL_TICK = -260229;

const POOL = () =>
  buildPool({
    price: 5,
    liquidity: 20_000n * 10n ** 12n,
    fee: 3000,
    token0: { symbol: "AMC", decimals: 18 },
    token1: { symbol: "USDG", decimals: 6 },
  });

/** Decode calldata the way the position manager does. */
function unpack(calldata) {
  assert.equal(calldata.slice(0, 10), MODIFY_LIQUIDITIES_SELECTOR);
  const [unlock, deadline] = abi.decode(["bytes", "uint256"], "0x" + calldata.slice(10));
  const [codes, params] = abi.decode(["bytes", "bytes[]"], unlock);
  return { codes, params, deadline };
}

/* --------------------------------------------------------------- the math */

test("liquidity for amounts inverts the amount deltas", () => {
  const sqrtA = sqrtPriceAtTick(-261300);
  const sqrtB = sqrtPriceAtTick(-259260);
  const sqrtP = sqrtPriceAtTick(-260229);
  const amount0 = 2_000n * 10n ** 18n;
  const amount1 = 10_000n * 10n ** 6n;

  const L = liquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1);
  assert.ok(L > 0n);

  // Whichever side binds, neither amount is exceeded.
  assert.ok(amount0Delta(sqrtP, sqrtB, L) <= amount0);
  assert.ok(amount1Delta(sqrtA, sqrtP, L) <= amount1);

  // And one of them is consumed almost entirely, or the position was undersized.
  const used1 = amount1Delta(sqrtA, sqrtP, L);
  assert.ok(used1 * 1000n > amount1 * 999n, "the binding side is fully used");
});

test("a range below or above the price is one-sided", () => {
  const sqrtA = sqrtPriceAtTick(1000);
  const sqrtB = sqrtPriceAtTick(2000);
  const below = liquidityForAmounts(sqrtPriceAtTick(500), sqrtA, sqrtB, 10n ** 18n, 0n);
  assert.ok(below > 0n, "priced under the range, token0 alone sizes it");
  const above = liquidityForAmounts(sqrtPriceAtTick(3000), sqrtA, sqrtB, 0n, 10n ** 18n);
  assert.ok(above > 0n, "priced over it, token1 alone does");
});

test("ticks round outward, never inward", () => {
  assert.equal(alignTick(101, 60, "down"), 60);
  assert.equal(alignTick(101, 60, "up"), 120);
  assert.equal(alignTick(-101, 60, "down"), -120);
  assert.equal(alignTick(-101, 60, "up"), -60);
});

test("a price becomes a tick that becomes the price again", () => {
  const tick = tickAtPrice(5, 18, 6);
  const back = (1.0001 ** tick) * 10 ** (18 - 6);
  assert.ok(Math.abs(back - 5) / 5 < 1e-3, `${back}`);
});

test("decimals are required, because getting them wrong is not a small error", () => {
  assert.notEqual(tickAtPrice(5, 18, 6), tickAtPrice(5, 6, 18));
  assert.throws(() => tickAtPrice(0, 18, 6), /positive/);
});

/* ------------------------------------------------------------- the encoding */

test("a mint is a mint followed by paying for it", () => {
  const { codes, params, deadline } = unpack(
    planMint({
      key: KEY, tickLower: -120, tickUpper: 120, liquidity: 5n,
      amount0Max: 7n, amount1Max: 9n, owner: VAULT, deadline: 1800000000n,
    }),
  );
  assert.equal(codes, "0x020d");
  assert.equal(deadline, 1800000000n);

  const mint = abi.decode(
    ["(address,address,uint24,int24,address)", "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"],
    params[0],
  );
  assert.equal(mint[0][0], KEY.currency0);
  assert.equal(Number(mint[1]), -120);
  assert.equal(Number(mint[2]), 120);
  assert.equal(mint[3], 5n);
  assert.equal(mint[6], VAULT);

  const pair = abi.decode(["address", "address"], params[1]);
  assert.deepEqual([pair[0], pair[1]], [KEY.currency0, KEY.currency1]);
});

/** v4 has no collect action; a decrease of nothing is how it is spelled. */
test("collecting fees decreases zero liquidity and takes the pair", () => {
  const { codes, params } = unpack(
    planCollect({ key: KEY, tokenId: 42n, recipient: VAULT, deadline: 1n }),
  );
  assert.equal(codes, "0x0111");
  const dec = abi.decode(["uint256", "uint256", "uint128", "uint128", "bytes"], params[0]);
  assert.equal(dec[0], 42n);
  assert.equal(dec[1], 0n, "the position itself is untouched");
  const take = abi.decode(["address", "address", "address"], params[1]);
  assert.equal(take[2], VAULT);
});

test("closing burns and takes", () => {
  const { codes, params } = unpack(
    planClose({ key: KEY, tokenId: 7n, amount0Min: 0n, amount1Min: 0n, recipient: VAULT, deadline: 1n }),
  );
  assert.equal(codes, "0x0311");
  assert.equal(abi.decode(["uint256", "uint128", "uint128", "bytes"], params[0])[0], 7n);
});

/**
 * Re-centring in one unlock is the point: two transactions can half-succeed and
 * leave the desk holding inventory with no position.
 */
test("re-centring burns and mints in a single call, closing both currencies", () => {
  const { codes, params } = unpack(
    planRecentre({
      key: KEY, tokenId: 7n, amount0Min: 0n, amount1Min: 0n,
      tickLower: -180, tickUpper: 180, liquidity: 11n,
      amount0Max: 1n, amount1Max: 2n, owner: VAULT, deadline: 1n,
    }),
  );
  assert.equal(codes, "0x03021212");
  assert.equal(params.length, 4);
  assert.equal(abi.decode(["address"], params[2])[0], KEY.currency0);
  assert.equal(abi.decode(["address"], params[3])[0], KEY.currency1);
});

test("the action codes are the ones the periphery library defines", () => {
  assert.deepEqual(ACTIONS, {
    INCREASE_LIQUIDITY: 0x00, DECREASE_LIQUIDITY: 0x01, MINT_POSITION: 0x02,
    BURN_POSITION: 0x03, SETTLE_PAIR: 0x0d, TAKE_PAIR: 0x11, CLOSE_CURRENCY: 0x12,
  });
});

/* --------------------------------------------------------- going via the vault */

test("a venue is never called directly", () => {
  const call = viaVault(VAULT, PM, "0xabcdef", "do a thing");
  assert.equal(call.to, VAULT);
  assert.equal(call.data.slice(0, 10), id("exec(address,uint256,bytes)").slice(0, 10));
  const [venue, value, data] = abi.decode(
    ["address", "uint256", "bytes"],
    "0x" + call.data.slice(10),
  );
  assert.equal(venue.toLowerCase(), PM);
  assert.equal(value, 0n);
  assert.equal(data, "0xabcdef");
});

/** The position manager pulls through Permit2, so one approval is not enough. */
test("a mint needs both the ERC20 approval and the Permit2 allowance", () => {
  const calls = approvalsFor({ vault: VAULT, permit2: ADDR(5), positionManager: PM }, ADDR(1), 100n, 999);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.slice(0, 10), id("approveVenue(address,address,uint256)").slice(0, 10));
  // The second goes through exec, because it is a call to Permit2 itself.
  assert.equal(calls[1].data.slice(0, 10), id("exec(address,uint256,bytes)").slice(0, 10));
  assert.match(calls[1].description, /Permit2/);
});

/* -------------------------------------------------------------- reading back */

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (addr) => "0x" + addr.slice(2).padStart(64, "0");

test("the token id is read from the log, never assumed", () => {
  const logs = [
    { address: PM, topics: [TRANSFER, topic(ADDR(0)), topic(VAULT), "0x" + (77).toString(16).padStart(64, "0")], data: "0x" },
  ];
  assert.equal(tokenIdFromLogs(logs, PM, VAULT), 77n);
  assert.equal(tokenIdFromLogs(logs, ADDR(9), VAULT), null, "wrong contract");
  assert.equal(tokenIdFromLogs(logs, PM, ADDR(9)), null, "minted to someone else");
  assert.equal(tokenIdFromLogs([], PM, VAULT), null);
});

test("a band is centred on the price and rounded outward", () => {
  const pool = POOL();
  const { tickLower, tickUpper } = bandTicks(pool, 0.1);
  // Math.abs, because a negative tick gives -0 and strict equality separates
  // that from 0.
  assert.equal(Math.abs(tickLower % 60), 0);
  assert.equal(Math.abs(tickUpper % 60), 0);
  assert.ok(tickLower < pool.tick && pool.tick < tickUpper);

  const tighter = bandTicks(pool, 0.02);
  assert.ok(tighter.tickLower > tickLower && tighter.tickUpper < tickUpper);
});

test("a mint is capped by what the vault actually holds", () => {
  const pool = POOL();
  const { tickLower, tickUpper } = bandTicks(pool, 0.1);
  const full = sizeMint({
    state: pool, tickLower, tickUpper,
    quoteAmount: 10_000n * 10n ** 6n,
    balance0: 10n ** 24n, balance1: 10n ** 12n,
  });
  const broke = sizeMint({
    state: pool, tickLower, tickUpper,
    quoteAmount: 10_000n * 10n ** 6n,
    balance0: 0n, balance1: 10n ** 12n,
  });
  assert.ok(full.liquidity > 0n);
  assert.ok(broke.liquidity < full.liquidity, "no token0, so a smaller position");
});

/* ---------------------------------------------------------------- the flow */

function fakeChain(over = {}) {
  const sent = [];
  const pool = POOL();
  return {
    sent,
    ctx: {
      vault: VAULT,
      positionManager: PM,
      permit2: ADDR(5),
      poolFor: () => ({ key: KEY, state: pool }),
      positionFor: () => ({ key: KEY, tokenId: 7n, capital: 10_000, halfWidth: 0.1 }),
      readPool: async () => pool,
      balanceOf: async () => 10n ** 24n,
      receipt: async (hash) => ({
        ok: true,
        logs: [
          { address: PM, topics: [TRANSFER, topic(ADDR(0)), topic(VAULT), "0x" + (91).toString(16).padStart(64, "0")], data: "0x" },
        ],
        hash,
      }),
      signer: {
        dryRun: false,
        description: "fake",
        address: async () => ADDR(8),
        send: async (call) => { sent.push(call); return { hash: "0x" + (sent.length).toString(16).padStart(64, "0") }; },
      },
      now: () => 1_700_000_000,
      ...over,
    },
  };
}

const openIntent = {
  id: "o1", kind: "open", chain: "robinhood", pool: "AMC/USDG", venueKind: "band",
  capital: 10_000, lower: 0, upper: 0, halfWidth: 0.1, reason: "test",
};

test("opening approves twice, mints, and reports the id from the log", async () => {
  const { ctx, sent } = fakeChain();
  const result = await makeV4Executor(ctx)(openIntent);
  assert.equal(sent.length, 3, "two approvals then the mint");
  assert.equal(result.handle, "91");
  assert.ok(result.txHash);
  assert.match(sent[2].description, /^mint AMC\/USDG/);
});

test("a lost receipt is unresolved, never a failure", async () => {
  const { ctx } = fakeChain({ receipt: async () => null });
  await assert.rejects(makeV4Executor(ctx)(openIntent), (e) => {
    assert.ok(e instanceof Unconfirmed, "must be Unconfirmed, or the position is opened twice");
    return true;
  });
});

test("a revert is an ordinary failure, and is recorded as one", async () => {
  const { ctx } = fakeChain({ receipt: async () => ({ ok: false, logs: [] }) });
  await assert.rejects(makeV4Executor(ctx)(openIntent), (e) => {
    assert.ok(!(e instanceof Unconfirmed));
    assert.match(e.message, /reverted/);
    return true;
  });
});

/** Succeeded, and the desk cannot say what it owns. That is not a success. */
test("a mint with no Transfer to the vault is unresolved", async () => {
  const { ctx } = fakeChain({ receipt: async () => ({ ok: true, logs: [] }) });
  await assert.rejects(makeV4Executor(ctx)(openIntent), (e) => {
    assert.ok(e instanceof Unconfirmed);
    assert.match(e.message, /no Transfer to the vault/);
    return true;
  });
});

test("re-centring is one call, and reports the new id", async () => {
  const { ctx, sent } = fakeChain();
  const result = await makeV4Executor(ctx)({
    id: "r1", kind: "rebalance", positionId: "p1", lower: 0, upper: 0, reason: "drift",
  });
  assert.equal(sent.length, 1, "burn and mint travel together");
  assert.equal(result.handle, "91");
  const { codes } = unpack(
    abi.decode(["address", "uint256", "bytes"], "0x" + sent[0].data.slice(10))[2],
  );
  assert.equal(codes, "0x03021212");
});

test("sweeping collects and claims no figure it did not measure", async () => {
  const { ctx, sent } = fakeChain();
  const result = await makeV4Executor(ctx)({
    id: "s1", kind: "sweep", positionId: "p1", reason: "threshold",
  });
  assert.equal(sent.length, 1);
  assert.equal(result.amount, undefined, "the chain knows the amount, not this");
  assert.ok(result.txHash);
});

test("a dry-run signer still produces the calls, and moves nothing", async () => {
  const signer = new DryRunSigner();
  const { ctx } = fakeChain({ signer });
  await makeV4Executor(ctx)(openIntent);
  assert.equal(signer.calls.length, 3);
  assert.equal(signer.dryRun, true);
});

/* ------------------------------------------------------------- reconciling */

const { makeV4Reconciler, broadcastFor } = await import("../src/lib/keeper/reconcile-v4.ts");
const { MemoryJournal, submit, loadState } = await import("../src/lib/keeper/registry.ts");

const openFor = (id) => ({ ...openIntent, id });

test("a broadcast hash is journalled when the outcome is unknown", async () => {
  const journal = new MemoryJournal();
  const result = await submit(journal, openFor("o9"), async () => {
    throw new Unconfirmed("timed out", "0xfeed");
  });
  assert.equal(result.unresolved, true);

  const records = await journal.read();
  assert.equal(broadcastFor(records, "o9"), "0xfeed");
  // And it is still in flight: a broadcast is not a settlement.
  assert.equal((await loadState(journal)).inFlight.length, 1);
  assert.equal((await loadState(journal)).positions.length, 0);
});

test("nothing broadcast means nothing happened", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 1, kind: "intent", intent: openFor("o1") });
  const reconcile = makeV4Reconciler({
    journal, positionManager: PM, vault: VAULT,
    receipt: async () => { throw new Error("must not be called"); },
  });
  assert.deepEqual(await reconcile(openFor("o1")), { found: null });
});

test("a mined mint reconciles to the id in its own logs", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 1, kind: "intent", intent: openFor("o1") });
  await journal.append({ at: 2, kind: "broadcast", intentId: "o1", txHash: "0xabc" });
  const reconcile = makeV4Reconciler({
    journal, positionManager: PM, vault: VAULT,
    receipt: async () => ({
      ok: true,
      logs: [{ address: PM, topics: [TRANSFER, topic(ADDR(0)), topic(VAULT), "0x" + (55).toString(16).padStart(64, "0")], data: "0x" }],
    }),
  });
  assert.deepEqual(await reconcile(openFor("o1")), { found: "55", txHash: "0xabc" });
});

test("a reverted call reconciles to nothing", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 2, kind: "broadcast", intentId: "o1", txHash: "0xabc" });
  const reconcile = makeV4Reconciler({
    journal, positionManager: PM, vault: VAULT,
    receipt: async () => ({ ok: false, logs: [] }),
  });
  assert.equal((await reconcile(openFor("o1"))).found, null);
});

/**
 * The one that must not be guessed. A transaction still in the mempool may yet
 * mine, so neither answer is safe and the keeper stops instead.
 */
test("a pending transaction stops the keeper rather than being decided", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 2, kind: "broadcast", intentId: "o1", txHash: "0xabc" });
  const reconcile = makeV4Reconciler({
    journal, positionManager: PM, vault: VAULT,
    receipt: async () => null,
  });
  await assert.rejects(reconcile(openFor("o1")), /not mined yet/);
});

test("a sweep reconciles on having mined at all", async () => {
  const journal = new MemoryJournal();
  await journal.append({ at: 2, kind: "broadcast", intentId: "s1", txHash: "0xabc" });
  const reconcile = makeV4Reconciler({
    journal, positionManager: PM, vault: VAULT,
    receipt: async () => ({ ok: true, logs: [] }),
  });
  const out = await reconcile({ id: "s1", kind: "sweep", positionId: "p1", reason: "" });
  assert.equal(out.found, "0xabc");
});

/* ------------------------------------------------------- assembling a call */

const { assemble, DEFAULT_FEES } = await import("../src/lib/keeper/tx.ts");

const node = (over = {}) => {
  const answers = {
    eth_chainId: "0x1237",
    eth_getTransactionCount: "0x5",
    eth_getBlockByNumber: { baseFeePerGas: "0x" + (20n * 10n ** 9n).toString(16) },
    eth_maxPriorityFeePerGas: "0x" + (10n ** 9n).toString(16),
    eth_estimateGas: "0x" + (400_000).toString(16),
    ...over,
  };
  return async (method) => {
    if (answers[method] instanceof Error) throw answers[method];
    return answers[method];
  };
};

test("a transaction is assembled from the node, not from constants", async () => {
  const tx = await assemble(node(), ADDR(8), { to: VAULT, data: "0x1234", description: "x" });
  assert.equal(tx.chainId, 0x1237);
  assert.equal(tx.nonce, 5);
  assert.equal(tx.gasLimit, 500_000n, "the estimate, with headroom");
  assert.equal(tx.maxPriorityFeePerGas, 10n ** 9n);
  assert.equal(tx.maxFeePerGas, 41n * 10n ** 9n, "two base fees plus the tip");
});

test("a gas spike is a reason not to send, not a cost to absorb", async () => {
  const spiked = node({ eth_getBlockByNumber: { baseFeePerGas: "0x" + (400n * 10n ** 9n).toString(16) } });
  await assert.rejects(
    assemble(spiked, ADDR(8), { to: VAULT, data: "0x", description: "x" }),
    /over the .* ceiling/,
  );
  assert.ok(DEFAULT_FEES.maxFeeCeiling > 0n);
});

test("a node with no priority fee method still assembles", async () => {
  const old = node({ eth_maxPriorityFeePerGas: new Error("method not found") });
  const tx = await assemble(old, ADDR(8), { to: VAULT, data: "0x", description: "x" });
  assert.ok(tx.maxPriorityFeePerGas > 0n);
});

/** A ladder goes above the price and is funded with the token alone. */
test("a ladder intent places above the price and commits no quote", async () => {
  const { ctx, sent } = fakeChain({ balanceOf: async () => 1_000n * 10n ** 18n });
  await makeV4Executor(ctx)({
    ...openIntent, id: "l1", venueKind: "ladder", gap: 0.02, width: 0.1, quantity: 1_000,
  });
  const mint = unpack(
    abi.decode(["address", "uint256", "bytes"], "0x" + sent.at(-1).data.slice(10))[2],
  );
  const decoded = abi.decode(
    ["(address,address,uint24,int24,address)", "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"],
    mint.params[0],
  );
  const [tickLower, tickUpper] = [Number(decoded[1]), Number(decoded[2])];
  assert.ok(tickLower > POOL_TICK, `${tickLower} must sit above the current tick`);
  assert.ok(tickUpper > tickLower);
  assert.equal(decoded[5], 0n, "no quote is committed");
});
