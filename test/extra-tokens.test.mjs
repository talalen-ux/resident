/**
 * The second tier of tradable tokens.
 *
 * Two things are being protected. Decimals read wrong mis-scale every figure
 * downstream without looking wrong, and a pool hours old with five figures of
 * percentage change is the exact shape a volume screener rewards and a range
 * cannot be quoted around.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";

import {
  DEFAULT_EXTRA_GATES,
  ERC20_SELECTORS,
  checkExtraGates,
  decodeSymbol,
  gatesFrom,
  parseExtraTokens,
  resolveExtraTokens,
  resolveToken,
} from "../src/lib/desk/extra-tokens.ts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const stringReturn = (s) =>
  AbiCoder.defaultAbiCoder().encode(["string"], [s]);

test("both selectors match their signature", () => {
  assert.equal(ERC20_SELECTORS.symbol, id("symbol()").slice(0, 10));
  assert.equal(ERC20_SELECTORS.decimals, id("decimals()").slice(0, 10));
});

/* ------------------------------------------------------------------ parsing */

test("addresses are parsed, lowercased and deduped", () => {
  const list = parseExtraTokens(` ${A} , ${B.toUpperCase().replace("0X", "0x")} , ${A} `);
  assert.deepEqual(list, [A.toLowerCase(), B.toLowerCase()]);
});

test("an empty or absent list is empty, not an error", () => {
  assert.deepEqual(parseExtraTokens(undefined), []);
  assert.deepEqual(parseExtraTokens("   "), []);
});

test("a typo is refused rather than skipped", () => {
  // Skipping would leave a token the desk silently will not trade, which looks
  // exactly like a token that never had any volume.
  assert.throws(() => parseExtraTokens(`${A},CASHCAT`), /not an address/);
  assert.throws(() => parseExtraTokens("0x123"), /not an address/);
});

/* ------------------------------------------------------------------ symbols */

test("a standard string symbol decodes", () => {
  assert.equal(decodeSymbol(stringReturn("CASHCAT")), "CASHCAT");
});

test("a bytes32 symbol decodes, because older tokens return one", () => {
  const padded = "0x" + Buffer.from("PONS").toString("hex").padEnd(64, "0");
  assert.equal(decodeSymbol(padded), "PONS");
});

test("an empty answer is null, not an empty symbol", () => {
  assert.equal(decodeSymbol("0x"), null);
  assert.equal(decodeSymbol(""), null);
});

/* ----------------------------------------------------------------- resolving */

const reader = (symbol, decimals) => async (_to, data) => {
  if (data === ERC20_SELECTORS.symbol) return symbol;
  if (data === ERC20_SELECTORS.decimals) return `0x${word(decimals)}`;
  throw new Error("unexpected call");
};

test("a token resolves to its on-chain symbol and decimals", async () => {
  const meta = await resolveToken(reader(stringReturn("CASHCAT"), 18), A);
  assert.equal(meta.symbol, "CASHCAT");
  assert.equal(meta.decimals, 18);
  assert.equal(meta.address, A);
});

test("six decimals are read, not assumed to be eighteen", async () => {
  // The whole reason these are read rather than configured. An 18 where 6 was
  // true reports a balance a trillion times too large, and nothing looks wrong.
  const meta = await resolveToken(reader(stringReturn("USDX"), 6), A);
  assert.equal(meta.decimals, 6);
});

test("an address that does not answer symbol is refused", async () => {
  await assert.rejects(
    resolveToken(reader("0x", 18), A),
    /not a token the desk can price/,
  );
});

test("nonsense decimals are refused rather than clamped", async () => {
  await assert.rejects(resolveToken(reader(stringReturn("X"), 99), A), /cannot be a token's decimals/);
});

test("one unreadable address does not cost the others", async () => {
  const call = async (to, data) => {
    if (to === B) return "0x";
    if (data === ERC20_SELECTORS.symbol) return stringReturn("OK");
    return `0x${word(18)}`;
  };
  const { registry, failed } = await resolveExtraTokens(call, [A, B]);
  assert.equal(registry.size, 1);
  assert.equal(registry.get(A).symbol, "OK");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].address, B);
});

/* -------------------------------------------------------------------- gates */

const pool = (over = {}) => ({
  ageMinutes: 60 * 24 * 30,
  hasHook: false,
  liquidityUsd: 1_000_000,
  ...over,
});

test("a mature, deep, hookless pool passes", () => {
  assert.equal(checkExtraGates(pool()).ok, true);
});

test("a pool hours old is refused", () => {
  // The class a volume screener rewards most and a range cannot be quoted
  // around: real volume, at prices that existed for an hour.
  const verdict = checkExtraGates(pool({ ageMinutes: 180 }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /3.0h old/);
});

test("a hook is refused by default", () => {
  const verdict = checkExtraGates(pool({ hasHook: true }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /take the LP's fee/);
});

test("a hook is allowed when the operator says so", () => {
  const gates = { ...DEFAULT_EXTRA_GATES, rejectHooks: false };
  assert.equal(checkExtraGates(pool({ hasHook: true }), gates).ok, true);
});

test("a thin book is refused, with the number in the reason", () => {
  const verdict = checkExtraGates(pool({ liquidityUsd: 62_000 }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /62,000 in band/);
});

test("age is checked before depth, because it is the cheaper disqualifier", () => {
  const verdict = checkExtraGates(pool({ ageMinutes: 60, liquidityUsd: 1 }));
  assert.match(verdict.reason, /old/);
});

/* ----------------------------------------------------------------- env */

test("the gates default when nothing is set", () => {
  assert.deepEqual(gatesFrom({}), DEFAULT_EXTRA_GATES);
});

test("each floor can be moved", () => {
  const gates = gatesFrom({
    RESIDENT_EXTRA_MIN_AGE_MINUTES: "60",
    RESIDENT_EXTRA_MIN_LIQUIDITY: "50000",
    RESIDENT_EXTRA_ALLOW_HOOKS: "1",
  });
  assert.equal(gates.minAgeMinutes, 60);
  assert.equal(gates.minLiquidityUsd, 50_000);
  assert.equal(gates.rejectHooks, false);
});

test("a floor that is not a number is refused, not treated as zero", () => {
  // Zero would silently remove the gate, which is the opposite of what
  // someone fat-fingering this variable intended.
  assert.throws(() => gatesFrom({ RESIDENT_EXTRA_MIN_LIQUIDITY: "lots" }), /not a number/);
  assert.throws(() => gatesFrom({ RESIDENT_EXTRA_MIN_AGE_MINUTES: "-5" }), /not a number/);
});
