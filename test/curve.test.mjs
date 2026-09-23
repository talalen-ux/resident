/**
 * Sweeping the bonding curve.
 *
 * The selector assertions are against PonsV2BondingCurve.sol. The rest are
 * about the two ways this call reverts — the wrong caller, and a buyback
 * earmark — both of which are cheaper to read than to discover on chain.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { id } from "ethers";

import {
  CURVE_SELECTORS,
  curveState,
  curveSweep,
  curveSweepCall,
} from "../src/lib/keeper/curve.ts";

const CURVE = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";
const SOMEONE = "0x3333333333333333333333333333333333333333";

const hex = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const addr = (a) => `0x${a.slice(2).padStart(64, "0")}`;

const reader = (over = {}) => {
  const answers = {
    [CURVE_SELECTORS.quoteFeeBalance]: hex(900),
    [CURVE_SELECTORS.creatorTaxBalance]: hex(100),
    [CURVE_SELECTORS.buybackQuoteBalance]: hex(0),
    [CURVE_SELECTORS.graduated]: hex(0),
    [CURVE_SELECTORS.deployer]: addr(VAULT),
    ...over,
  };
  return async (to, data) => {
    assert.equal(to, CURVE);
    return answers[data];
  };
};

test("every selector matches the signature it claims", () => {
  const signatures = {
    sweepFees: "sweepFees(uint256)",
    quoteFeeBalance: "quoteFeeBalance()",
    creatorTaxBalance: "creatorTaxBalance()",
    buybackQuoteBalance: "buybackQuoteBalance()",
    graduated: "graduated()",
    deployer: "deployer()",
    pairToken: "pairToken()",
  };
  for (const [name, signature] of Object.entries(signatures)) {
    assert.equal(CURVE_SELECTORS[name], id(signature).slice(0, 10), name);
  }
});

test("the sweep is the curve's, not the hook's", () => {
  // sweepPoolFees(bytes32,uint256,uint256) is the post-graduation call. Sent
  // to a curve it answers nothing; the revert reads as "no fees".
  assert.notEqual(
    CURVE_SELECTORS.sweepFees,
    id("sweepPoolFees(bytes32,uint256,uint256)").slice(0, 10),
  );
});

test("state adds the tax to the fee, because both are swept together", async () => {
  const state = await curveState(reader(), CURVE);
  assert.equal(state.quoteFees, 900n);
  assert.equal(state.creatorTax, 100n);
  assert.equal(state.pending, 1000n);
  assert.equal(state.graduated, false);
  assert.equal(state.operatorOnly, false);
  assert.equal(state.deployer.toLowerCase(), VAULT.toLowerCase());
});

test("it sweeps when the vault may and the amount clears the floor", async () => {
  const decision = curveSweep(CURVE, await curveState(reader(), CURVE), VAULT, 500n);
  assert.equal(decision.sweep, true);
  assert.equal(decision.call.to, CURVE);
  assert.equal(decision.call.data.slice(0, 10), CURVE_SELECTORS.sweepFees);
});

test("a buyback earmark makes the sweep Pons's, and that is not a failure", async () => {
  // The fees are not lost and nothing is misconfigured: their operator sweeps
  // and the escrow still credits the vault. Attempting it ourselves reverts on
  // InternalSwapRequiresOperator and spends gas proving what was readable.
  const state = await curveState(reader({ [CURVE_SELECTORS.buybackQuoteBalance]: hex(7) }), CURVE);
  const decision = curveSweep(CURVE, state, VAULT, 500n);
  assert.equal(decision.sweep, false);
  assert.match(decision.reason, /Pons's to make/);
});

test("it refuses when the curve still pays somebody else", async () => {
  // This is the misconfiguration worth catching: the sweep would revert with
  // NotFeeSweepOperator, and the fees are being credited to another address.
  const state = await curveState(reader({ [CURVE_SELECTORS.deployer]: addr(SOMEONE) }), CURVE);
  const decision = curveSweep(CURVE, state, VAULT, 500n);
  assert.equal(decision.sweep, false);
  assert.match(decision.reason, /point the launch fees at the vault/);
});

test("the recipient check ignores checksum case", async () => {
  const state = await curveState(reader(), CURVE);
  const decision = curveSweep(CURVE, state, VAULT.toUpperCase().replace("0X", "0x"), 500n);
  assert.equal(decision.sweep, true);
});

test("a graduated curve is finished, whatever it still reports", async () => {
  const state = await curveState(reader({ [CURVE_SELECTORS.graduated]: hex(1) }), CURVE);
  assert.equal(curveSweep(CURVE, state, VAULT, 500n).sweep, false);
});

test("dust is left to accumulate rather than swept at a loss", async () => {
  const state = await curveState(reader(), CURVE);
  const decision = curveSweep(CURVE, state, VAULT, 5000n);
  assert.equal(decision.sweep, false);
  assert.match(decision.reason, /under the floor/);
});

test("the buyback floor is zero because no swap can execute", () => {
  // Only ever sent when buybackQuoteBalance is zero, so this argument is never
  // consulted. It is not an unbounded slippage setting.
  const call = curveSweepCall(CURVE);
  assert.equal(call.data, `${CURVE_SELECTORS.sweepFees}${"0".repeat(64)}`);
});
