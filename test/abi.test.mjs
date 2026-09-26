/**
 * The committed ABI is still the contract's ABI.
 *
 * preflight reads src/lib/vault-abi.ts rather than compiling, so that the
 * check gating a funding transaction runs in the container as well as in a
 * development checkout. That trade is only sound while the committed file and
 * the contract cannot drift apart, which is what this test is.
 *
 * It fails the moment contracts/ResidentVault.sol changes without `npm run
 * abi`. That is the intended failure: a stale ABI would have preflight ask a
 * deployed vault questions the source no longer poses, and report a mismatched
 * deployment as healthy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ABI_PATH, render, vaultAbi } from "../scripts/abi.mjs";
import { VAULT_ABI } from "../src/lib/vault-abi.ts";

test("the committed ABI matches a fresh compile", () => {
  assert.equal(
    readFileSync(ABI_PATH, "utf8"),
    render(vaultAbi()),
    "contracts/ResidentVault.sol has changed: run `npm run abi` and commit the result",
  );
});

test("every function preflight reads is in it", () => {
  // Read out of the script rather than listed here. A hand-kept list drifts
  // from the script it is meant to guard, and then guards nothing — the first
  // version of this test asserted a function name the contract never had.
  //
  // This matters because encodeFunctionData throws at the point of use, which
  // on preflight means after it has already printed half a report and looks
  // like a chain problem rather than a missing function.
  const script = readFileSync(
    new URL("../scripts/preflight.mjs", import.meta.url),
    "utf8",
  );
  const called = [...script.matchAll(/\bread\("([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(called.length > 5, "the reads could not be found in preflight.mjs");

  const names = new Set(
    VAULT_ABI.filter((entry) => entry.type === "function").map((entry) => entry.name),
  );
  for (const name of called) {
    assert.ok(names.has(name), `preflight reads ${name}, which the vault ABI does not have`);
  }
});

test("it is an ABI, not an empty array that would pass everything", () => {
  assert.ok(VAULT_ABI.length > 10, "a truncated ABI must not read as a valid one");
});
