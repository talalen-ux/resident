/**
 * Configurations that start cleanly and do the wrong thing.
 *
 * Each of these describes a container that would come up, run its loop, and
 * look like a desk that found nothing worth doing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkConfig, configFailure } from "../src/lib/keeper/preflight-config.ts";

const MAINNET = 4663;
const base = {
  rpcUrl: "https://rpc.example",
  allowMainnet: false,
  mainnetChainId: MAINNET,
  chainId: MAINNET,
};

test("a key with no vault is refused, because it would look like a quiet market", () => {
  const verdict = checkConfig({ ...base, key: "0xkey", allowMainnet: true });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => /RESIDENT_VAULT is not/.test(p)));
  // The fix belongs in the message, not in a document the operator has to find.
  assert.ok(verdict.problems.some((p) => /Deploy the vault first/.test(p)));
});

test("a key on mainnet without the flag is refused at startup, not per transaction", () => {
  const verdict = checkConfig({ ...base, key: "0xkey", vault: "0xvault" });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => /RESIDENT_ALLOW_MAINNET/.test(p)));
  // Both ways out are named: say it is intended, or drop to simulating.
  assert.ok(verdict.problems.some((p) => /RESIDENT_KEEPER_ADDRESS/.test(p)));
});

test("the same key with the flag set is allowed", () => {
  const verdict = checkConfig({
    ...base, key: "0xkey", vault: "0xvault", allowMainnet: true,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.mode, "sign");
});

test("a key on a chain that is not mainnet needs no flag", () => {
  const verdict = checkConfig({
    ...base, key: "0xkey", vault: "0xvault", chainId: 46630,
  });
  assert.equal(verdict.ok, true);
});

test("an unread chain id does not invent a mainnet refusal", () => {
  // chainId absent means the node has not answered yet. Refusing on a value
  // nobody read would block a keeper that is configured correctly.
  const verdict = checkConfig({
    ...base, key: "0xkey", vault: "0xvault", chainId: undefined,
  });
  assert.equal(verdict.ok, true);
});

test("no RPC is a refusal whatever else is set", () => {
  const verdict = checkConfig({ ...base, rpcUrl: undefined });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => /RESIDENT_RPC_URL/.test(p)));
});

test("half a launch is refused, because the other half fails silently", () => {
  const hookOnly = checkConfig({ ...base, ponsHook: "0xhook" });
  assert.equal(hookOnly.ok, false);
  assert.ok(hookOnly.problems.some((p) => /must be set together/.test(p)));

  const both = checkConfig({ ...base, ponsHook: "0xhook", ponsPoolId: "0xpool" });
  assert.equal(both.ok, true);

  const neither = checkConfig(base);
  assert.equal(neither.ok, true);
});

test("the mode is named from the variables alone", () => {
  assert.equal(checkConfig(base).mode, "journal");
  assert.equal(checkConfig({ ...base, keeperAddress: "0xabc" }).mode, "simulate");
  assert.equal(
    checkConfig({ ...base, key: "0xkey", vault: "0xv", allowMainnet: true }).mode,
    "sign",
  );
});

test("an address alongside a key is called out as ignored", () => {
  const verdict = checkConfig({
    ...base, key: "0xkey", keeperAddress: "0xabc", vault: "0xv", allowMainnet: true,
  });
  assert.equal(verdict.ok, true);
  // Not a refusal. It works; it just does not do what setting both suggests.
  assert.ok(verdict.notes.some((n) => /is ignored while/.test(n)));
});

test("a journal-only desk with a vault is told what it is missing", () => {
  const verdict = checkConfig({ ...base, vault: "0xvault" });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.notes.some((n) => /eth_estimateGas/.test(n)));
});

test("the failure text lists every problem, not just the first", () => {
  const verdict = checkConfig({ ...base, rpcUrl: undefined, key: "0xkey" });
  const text = configFailure(verdict);
  assert.match(text, /RESIDENT_RPC_URL/);
  assert.match(text, /RESIDENT_VAULT is not/);
  // An operator fixing one variable per deploy on a slow build is how an
  // afternoon goes.
  assert.ok(verdict.problems.length >= 2);
});
