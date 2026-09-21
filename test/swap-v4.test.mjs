/**
 * Selling harvested inventory back to the quote asset.
 *
 * The encoding assertions are against universal-router and v4-periphery source.
 * The rest are about a swap that succeeds and loses money: no slippage bound,
 * a line larger than the pool can absorb, a sale made the moment fees land.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, Interface, id } from "ethers";

import {
  DEFAULT_CONVERT,
  NoSlippageBound,
  SWAP_ACTIONS,
  V4_SWAP,
  minOutFor,
  shouldConvert,
  swapCall,
} from "../src/lib/keeper/swap-v4.ts";
import { UNISWAP } from "../src/lib/chain.ts";

const abi = AbiCoder.defaultAbiCoder();
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const TOKEN = "0x1111111111111111111111111111111111111111";

const key = {
  currency0: TOKEN < USDG ? TOKEN : USDG,
  currency1: TOKEN < USDG ? USDG : TOKEN,
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000",
};

const plan = (over = {}) => ({
  key, zeroForOne: true, amountIn: 1_000_000n, minOut: 990_000n,
  deadline: 1_800_000_000, ...over,
});

test("the command and actions are the ones the routers actually define", () => {
  // universal-router Commands.sol: V4_SWAP = 0x10.
  assert.equal(V4_SWAP, 0x10);
  // v4-periphery Actions.sol.
  assert.equal(SWAP_ACTIONS.swapExactInSingle, 0x06);
  assert.equal(SWAP_ACTIONS.settleAll, 0x0c);
  assert.equal(SWAP_ACTIONS.takeAll, 0x0f);
});

test("the call is execute(bytes,bytes[],uint256) on the UniversalRouter", () => {
  const call = swapCall(plan());
  assert.equal(call.to, UNISWAP.universalRouter);
  assert.equal(
    call.data.slice(0, 10),
    id("execute(bytes,bytes[],uint256)").slice(0, 10),
  );
});

test("the payload decodes back to one V4_SWAP carrying three actions", () => {
  const iface = new Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  ]);
  const [commands, inputs, deadline] = iface.decodeFunctionData(
    "execute",
    swapCall(plan()).data,
  );

  assert.equal(commands, "0x10");
  assert.equal(inputs.length, 1);
  assert.equal(Number(deadline), 1_800_000_000);

  const [actions, params] = abi.decode(["bytes", "bytes[]"], inputs[0]);
  // swap, then settle what is owed, then take what is due.
  assert.equal(actions, "0x060c0f");
  assert.equal(params.length, 3);
});

test("the swap carries the pool key, the direction and both amounts", () => {
  const iface = new Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  ]);
  const [, inputs] = iface.decodeFunctionData("execute", swapCall(plan()).data);
  const [, params] = abi.decode(["bytes", "bytes[]"], inputs[0]);

  const [decoded] = abi.decode(
    ["((address,address,uint24,int24,address),bool,uint128,uint128,bytes)"],
    params[0],
  );
  assert.equal(decoded[0][0].toLowerCase(), key.currency0.toLowerCase());
  assert.equal(decoded[0][1].toLowerCase(), key.currency1.toLowerCase());
  assert.equal(Number(decoded[0][2]), 3000);
  assert.equal(decoded[1], true);
  assert.equal(decoded[2], 1_000_000n);
  assert.equal(decoded[3], 990_000n);
});

test("SETTLE_ALL names the token sold and TAKE_ALL the token bought", () => {
  const iface = new Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  ]);
  const [, inputs] = iface.decodeFunctionData("execute", swapCall(plan()).data);
  const [, params] = abi.decode(["bytes", "bytes[]"], inputs[0]);

  const [settleCurrency, settleAmount] = abi.decode(["address", "uint256"], params[1]);
  const [takeCurrency, takeAmount] = abi.decode(["address", "uint256"], params[2]);

  // Reversed, this pays with the token it meant to receive.
  assert.equal(settleCurrency.toLowerCase(), key.currency0.toLowerCase());
  assert.equal(takeCurrency.toLowerCase(), key.currency1.toLowerCase());
  assert.equal(settleAmount, 1_000_000n);
  // The bound lands on TAKE_ALL too: it checks the whole credit, not just the
  // swap's own output.
  assert.equal(takeAmount, 990_000n);
});

test("selling the other way round swaps which currency is settled", () => {
  const iface = new Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  ]);
  const [, inputs] = iface.decodeFunctionData(
    "execute",
    swapCall(plan({ zeroForOne: false })).data,
  );
  const [, params] = abi.decode(["bytes", "bytes[]"], inputs[0]);
  const [settleCurrency] = abi.decode(["address", "uint256"], params[1]);
  assert.equal(settleCurrency.toLowerCase(), key.currency1.toLowerCase());
});

test("a swap with no slippage bound is refused", () => {
  // On a thin pool, any price means the whole line for nothing.
  assert.throws(() => swapCall(plan({ minOut: 0n })), NoSlippageBound);
});

test("a swap of nothing is refused rather than sent", () => {
  assert.throws(() => swapCall(plan({ amountIn: 0n })), /nothing to sell/);
});

/* ------------------------------------------------------------ the decision */

const held = (over = {}) => ({ quantity: 100, price: 10, heldIntervals: 500, ...over });

test("inventory is not sold the moment it arrives", () => {
  const fresh = shouldConvert(held({ heldIntervals: 5 }), 100_000);
  assert.equal(fresh.convert, false);
  // Fees arrive in the token precisely when that token is trading, and dumping
  // into the flow we just earned from pays the spread twice.
  assert.match(fresh.reason, /ladder has first refusal/);
});

test("inventory the ladder never cleared is sold", () => {
  const stale = shouldConvert(held(), 100_000);
  assert.equal(stale.convert, true);
  assert.equal(stale.amountIn, 100);
  assert.match(stale.reason, /the ladder did not clear it/);
});

test("a line larger than the pool can absorb is sold in part", () => {
  // $1,000 of inventory against a pool with $2,000 of depth: at 20% impact
  // only $400 may go, which is 40 tokens.
  const big = shouldConvert(held(), 2_000);
  assert.equal(big.convert, true);
  assert.equal(big.amountIn, 40);
  assert.match(big.reason, /more would take over 20% of the depth/);
});

test("dust is left alone", () => {
  const dust = shouldConvert(held({ quantity: 0.1, price: 10 }), 100_000);
  assert.equal(dust.convert, false);
  assert.match(dust.reason, /the gas costs more/);
});

test("an empty holding converts nothing rather than dividing by it", () => {
  assert.equal(shouldConvert(held({ quantity: 0 }), 100_000).convert, false);
  assert.equal(shouldConvert(held(), 0).convert, false);
});

test("the minimum out is the quoted value less slippage, in raw units", () => {
  // 100 tokens at $10, 1% slippage, 6-decimal quote.
  assert.equal(minOutFor(100, 10, 6), 990_000_000n);
  assert.equal(
    minOutFor(100, 10, 6, { ...DEFAULT_CONVERT, slippage: 0.05 }),
    950_000_000n,
  );
});

/* ------------------------------------------------ through the vault, live */

test("a conversion approves Permit2 and routes the swap through the vault", async () => {
  const { makeV4Executor } = await import("../src/lib/keeper/executor-v4.ts");
  const VAULT_ADDR = "0x9999999999999999999999999999999999999999";
  const sent = [];

  const state = {
    token0: { symbol: "TKN", decimals: 18, address: key.currency0 },
    token1: { symbol: "USDG", decimals: 6, address: key.currency1 },
  };

  const executor = makeV4Executor({
    vault: VAULT_ADDR,
    payoutAsset: key.currency1,
    poolFor: () => ({ key, state }),
    positionFor: () => null,
    readPool: async () => state,
    balanceOf: async () => 10n ** 21n, // 1000 whole tokens
    receipt: async () => ({ ok: true, logs: [] }),
    now: () => 1_000,
    call: async () => "0x0",
    signer: {
      dryRun: false, description: "test", address: async () => "0x1",
      send: async (c) => { sent.push(c); return { hash: "0xfeed" }; },
    },
  });

  const result = await executor({
    id: "c1", kind: "convert", pool: "TKN/USDG", quantity: 100, price: 10, reason: "",
  });

  // Two approvals then the swap: the router pulls through Permit2 exactly as
  // a mint does, so an ERC20 allowance alone is not enough.
  assert.equal(sent.length, 3);
  assert.equal(sent[2].to, VAULT_ADDR, "the swap must go through the vault, not direct");
  assert.match(sent[2].description, /sell /);
  // 100 tokens at $10 less 1% slippage, in 6-decimal quote units.
  assert.ok(Math.abs(result.amount - 990) < 1e-6, `expected ~990, got ${result.amount}`);
});

test("a conversion never sells more than the vault holds", async () => {
  const { makeV4Executor } = await import("../src/lib/keeper/executor-v4.ts");
  const sent = [];
  const state = {
    token0: { symbol: "TKN", decimals: 18, address: key.currency0 },
    token1: { symbol: "USDG", decimals: 6, address: key.currency1 },
  };
  const executor = makeV4Executor({
    vault: "0x99", payoutAsset: key.currency1,
    poolFor: () => ({ key, state }),
    positionFor: () => null,
    readPool: async () => state,
    // The vault holds 5 tokens; the intent asks to sell 100.
    balanceOf: async () => 5n * 10n ** 18n,
    receipt: async () => ({ ok: true, logs: [] }),
    now: () => 1_000,
    call: async () => "0x0",
    signer: {
      dryRun: false, description: "test", address: async () => "0x1",
      send: async (c) => { sent.push(c); return { hash: "0x1" }; },
    },
  });

  const result = await executor({
    id: "c1", kind: "convert", pool: "TKN/USDG", quantity: 100, price: 10, reason: "",
  });
  // The router pulls what the plan says and reverts after the gas is spent, so
  // the plan has to be what is actually there.
  assert.ok(Math.abs(result.amount - 49.5) < 1e-6, `expected ~49.5, got ${result.amount}`);
});

test("a pool with no quote side is refused rather than swapped the wrong way", async () => {
  const { makeV4Executor } = await import("../src/lib/keeper/executor-v4.ts");
  const state = {
    token0: { symbol: "A", decimals: 18, address: key.currency0 },
    token1: { symbol: "B", decimals: 18, address: key.currency1 },
  };
  const executor = makeV4Executor({
    vault: "0x99",
    payoutAsset: "0x7777777777777777777777777777777777777777",
    poolFor: () => ({ key, state }),
    positionFor: () => null,
    readPool: async () => state,
    balanceOf: async () => 10n ** 21n,
    receipt: async () => ({ ok: true, logs: [] }),
    now: () => 1_000,
    call: async () => "0x0",
    signer: {
      dryRun: false, description: "test", address: async () => "0x1",
      send: async () => ({ hash: "0x1" }),
    },
  });
  await assert.rejects(
    () => executor({ id: "c1", kind: "convert", pool: "A/B", quantity: 1, price: 1, reason: "" }),
    /neither side .* is the payout asset/,
  );
});
