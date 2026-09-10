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

test("the vault selector table matches the compiled ResidentVault ABI", () => {
  const { artifacts } = compile();
  const iface = new Interface(artifacts.ResidentVault.abi);

  const source = readFileSync("src/lib/desk/selectors.ts", "utf8");
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

/**
 * scripts/preflight.mjs is the gate that runs immediately before someone sends
 * the vault money. It reads through the compiled ABI rather than a selector
 * table, so a rename cannot silently break a read — but a rename CAN remove a
 * function the script expects, and it would then fail at the worst possible
 * moment. This pins the surface it depends on.
 */
test("preflight only calls functions the vault actually exposes", () => {
  const { artifacts } = compile();
  const iface = new Interface(artifacts.ResidentVault.abi);

  const source = readFileSync("scripts/preflight.mjs", "utf8");
  const called = [...source.matchAll(/\bread\("([A-Za-z_][A-Za-z0-9_]*)"/g)].map(
    (m) => m[1],
  );
  assert.ok(called.length >= 8, `expected several reads, found ${called.length}`);

  for (const name of new Set(called)) {
    assert.doesNotThrow(
      () => iface.getFunction(name),
      `preflight reads ${name}(), which the vault does not expose`,
    );
  }
});
