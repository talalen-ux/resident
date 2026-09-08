/**
 * The dashboard's RPC adapter calls the vault by raw selector, so a renamed or
 * re-signatured function would break it silently at runtime. This asserts the
 * hardcoded table still matches the compiled ABI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Interface } from "ethers";

import { compile } from "./harness.mjs";

test("rpc-adapter selectors match the compiled ResidentVault ABI", () => {
  const { artifacts } = compile();
  const iface = new Interface(artifacts.ResidentVault.abi);

  const source = readFileSync("src/lib/desk/rpc-adapter.ts", "utf8");
  const block = source.match(/export const SELECTORS = \{([\s\S]*?)\} as const;/);
  assert.ok(block, "could not find the SELECTORS table");

  const entries = [...block[1].matchAll(/(\w+):\s*"(0x[0-9a-f]{8})"/g)];
  assert.ok(entries.length >= 8, `expected the full table, found ${entries.length}`);

  for (const [, name, selector] of entries) {
    assert.equal(
      iface.getFunction(name).selector,
      selector,
      `${name}() selector drifted from the contract`,
    );
  }
});
