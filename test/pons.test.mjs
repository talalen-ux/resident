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
