/**
 * Claiming the launch's own fees back into the vault.
 *
 * The selector assertions are against the signatures in ponsdotdev/ponsfamily
 * contractsV2 (ILaunchpadV2.sol and PonsV2MemeHook.sol). The rest are about
 * calls that would silently do nothing: a claim encoded against the wrong
 * argument returns zero and looks like "no fees yet".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { id } from "ethers";

import {
  PONS_SELECTORS,
  claimCall,
  claimable,
  escrowOf,
  pending,
  sweepCall,
  verifyClaim,
} from "../src/lib/keeper/pons.ts";

const VAULT = "0x1111111111111111111111111111111111111111";
const HOOK = "0x2222222222222222222222222222222222222222";
const ESCROW = "0x3333333333333333333333333333333333333333";
const USDG = "0x4444444444444444444444444444444444444444";
const POOL = `0x${"ab".repeat(32)}`;

const hex = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, "0");
const wordAt = (data, i) => data.slice(10 + i * 64, 10 + (i + 1) * 64);

test("every selector matches the signature it claims", () => {
  const signatures = {
    claimToken: "claimToken(address)",
    balanceOfToken: "balanceOfToken(address,address)",
    sweepPoolFees: "sweepPoolFees(bytes32,uint256,uint256)",
    feeEscrow: "feeEscrow()",
    pendingFees: "pendingFees(bytes32,address)",
    pendingCreatorTax: "pendingCreatorTax(bytes32,address)",
  };
  for (const [name, signature] of Object.entries(signatures)) {
    assert.equal(PONS_SELECTORS[name], id(signature).slice(0, 10), name);
  }
});

test("claimToken is the token overload, not the bare claim", () => {
  // claim() and claim(uint256) exist too. Encoding either where claimToken was
  // meant sends a call that succeeds and moves the wrong asset, or nothing.
  assert.notEqual(PONS_SELECTORS.claimToken, id("claim()").slice(0, 10));
  assert.notEqual(PONS_SELECTORS.claimToken, id("claimToken(address,uint256)").slice(0, 10));
});

test("the escrow is read off the hook rather than configured", async () => {
  const asked = [];
  const call = async (to, data) => {
    asked.push({ to, data });
    return "0x" + hex(ESCROW);
  };
  assert.equal(await escrowOf(call, HOOK), ESCROW);
  assert.equal(asked[0].to, HOOK);
  assert.equal(asked[0].data, PONS_SELECTORS.feeEscrow);
});

test("claimable asks the escrow for this vault's balance of this token", async () => {
  let seen;
  const call = async (to, data) => {
    seen = { to, data };
    return "0x" + hex(12345);
  };
  assert.equal(await claimable(call, ESCROW, VAULT, USDG), 12345n);
  assert.equal(seen.to, ESCROW);
  // Argument order is recipient then token. Reversed, this reads the balance
  // of a token address that holds nothing and reports "no fees".
  assert.equal(wordAt(seen.data, 0), hex(VAULT));
  assert.equal(wordAt(seen.data, 1), hex(USDG));
});

test("pending adds both buckets, because a sweep pays them together", async () => {
  const call = async (to, data) =>
    data.startsWith(PONS_SELECTORS.pendingFees) ? "0x" + hex(900) : "0x" + hex(100);
  assert.equal(await pending(call, HOOK, POOL, USDG), 1000n);
});

test("an empty return reads as zero rather than throwing", async () => {
  const call = async () => "0x";
  assert.equal(await claimable(call, ESCROW, VAULT, USDG), 0n);
  assert.equal(await pending(call, HOOK, POOL, USDG), 0n);
});

test("the sweep call carries the pool id and two zero minimums", () => {
  const call = sweepCall(HOOK, POOL);
  assert.equal(call.to, HOOK);
  assert.ok(call.data.startsWith(PONS_SELECTORS.sweepPoolFees));
  assert.equal(wordAt(call.data, 0), POOL.slice(2));
  // Zero is only safe because a sweep needing an internal swap reverts for
  // anyone but Pons's operator, so this can never be the bound on our swap.
  assert.equal(wordAt(call.data, 1), hex(0));
  assert.equal(wordAt(call.data, 2), hex(0));
});

test("the claim call names the token and nothing else", () => {
  const call = claimCall(ESCROW, USDG);
  assert.equal(call.to, ESCROW);
  assert.equal(call.data, PONS_SELECTORS.claimToken + hex(USDG));
});

test("a claim that did not raise the vault's balance is not ok", async () => {
  // The escrow implementation is not published, so "claimToken pays
  // msg.sender" is an inference. If it is wrong, this is what catches it
  // before the desk journals income it does not hold.
  const unchanged = await verifyClaim(async () => "0x" + hex(500), USDG, VAULT, 500n);
  assert.equal(unchanged.ok, false);
  assert.equal(unchanged.received, 0n);

  const landed = await verifyClaim(async () => "0x" + hex(1500), USDG, VAULT, 500n);
  assert.equal(landed.ok, true);
  assert.equal(landed.received, 1000n);
});

test("a balance that somehow fell is reported as nothing received, not negative", async () => {
  const drop = await verifyClaim(async () => "0x" + hex(100), USDG, VAULT, 500n);
  assert.equal(drop.ok, false);
  assert.equal(drop.received, 0n);
});

/* ------------------------------------------------- distributing the 15% */

test("a distribution pays holders pro rata, capped by the vault's rate limit", async () => {
  const { makeV4Executor } = await import("../src/lib/keeper/executor-v4.ts");
  const { SELECTORS } = await import("../src/lib/desk/selectors.ts");
  const { Interface } = await import("ethers");

  const VAULT_ADDR = "0x9999999999999999999999999999999999999999";
  const sent = [];
  const executor = makeV4Executor({
    vault: VAULT_ADDR,
    payoutAsset: USDG,
    poolFor: () => null,
    positionFor: () => null,
    readPool: async () => { throw new Error("unused"); },
    balanceOf: async () => 0n,
    receipt: async () => ({ ok: true, logs: [] }),
    now: () => 0,
    call: async (to, data) => {
      if (data === SELECTORS.owed) return "0x" + hex(1000);
      // The cap is lower than what is owed, so only the cap may go out.
      if (data.startsWith(SELECTORS.rateLimitRemaining)) return "0x" + hex(600);
      throw new Error(`unexpected call ${data.slice(0, 10)}`);
    },
    holders: async () => new Map([[VAULT, 60n], [HOOK, 40n]]),
    signer: {
      dryRun: false,
      description: "test",
      address: async () => "0x1",
      send: async (call) => { sent.push(call); return { hash: "0xdead" }; },
    },
  });

  const result = await executor({ id: "d1", kind: "distribute", reason: "" });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, VAULT_ADDR);

  const iface = new Interface(["function distribute(address[] recipients, uint256[] amounts)"]);
  const [recipients, amounts] = iface.decodeFunctionData("distribute", sent[0].data);
  assert.equal(recipients.length, 2);
  // 600 split 60/40, not the 1000 owed: the vault reverts the whole call if
  // the total exceeds its per-window cap.
  assert.equal(amounts[0], 360n);
  assert.equal(amounts[1], 240n);
  assert.equal(result.amount, 600);
});

test("a distribution with nothing owed does nothing rather than sending an empty call", async () => {
  const { makeV4Executor } = await import("../src/lib/keeper/executor-v4.ts");
  const { SELECTORS } = await import("../src/lib/desk/selectors.ts");
  const sent = [];
  const executor = makeV4Executor({
    vault: "0x99", payoutAsset: USDG,
    poolFor: () => null, positionFor: () => null,
    readPool: async () => { throw new Error("unused"); },
    balanceOf: async () => 0n,
    receipt: async () => ({ ok: true, logs: [] }),
    now: () => 0,
    call: async (to, data) => (data === SELECTORS.owed ? "0x" + hex(0) : "0x" + hex(0)),
    holders: async () => new Map([[VAULT, 1n]]),
    signer: {
      dryRun: false, description: "test", address: async () => "0x1",
      send: async (c) => { sent.push(c); return { hash: "0x1" }; },
    },
  });
  assert.deepEqual(await executor({ id: "d1", kind: "distribute", reason: "" }), { amount: 0 });
  assert.equal(sent.length, 0);
});

test("a distribution refuses rather than guessing when there is no holder source", async () => {
  const { makeV4Executor } = await import("../src/lib/keeper/executor-v4.ts");
  const executor = makeV4Executor({
    vault: "0x99", payoutAsset: USDG,
    poolFor: () => null, positionFor: () => null,
    readPool: async () => { throw new Error("unused"); },
    balanceOf: async () => 0n,
    receipt: async () => ({ ok: true, logs: [] }),
    now: () => 0,
    call: async () => "0x0",
    signer: {
      dryRun: false, description: "test", address: async () => "0x1",
      send: async () => ({ hash: "0x1" }),
    },
  });
  // Paying a guessed list is worse than not paying.
  await assert.rejects(
    () => executor({ id: "d1", kind: "distribute", reason: "" }),
    /no holder source configured/,
  );
});
