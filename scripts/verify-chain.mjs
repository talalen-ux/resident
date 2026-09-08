#!/usr/bin/env node
/**
 * Verify the chain constants against the actual chain.
 *
 * Everything in src/lib/chain.ts was transcribed from official sources but
 * never checked on-chain, because the environment it was written in blocks the
 * Robinhood Chain RPC. This closes that gap: run it once from somewhere with
 * network access, before anything touches money.
 *
 *   RESIDENT_USDG=0x... RESIDENT_VAULT=0x... \
 *     node --experimental-strip-types scripts/verify-chain.mjs
 *
 * Checks:
 *   - the RPC answers, and its chain id matches what we expect
 *   - every address in the manifest has bytecode (an EOA or empty slot fails)
 *   - USDG answers symbol() and decimals()
 *   - the v3 factory answers owner(), so it behaves like a factory
 *
 * Exit code is non-zero if anything fails, so it can gate a deploy.
 */

import { ALL_TOKENS, addressManifest, requireChain } from "../src/lib/chain.ts";

const rpc = async (method, params = []) => {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
};

let config;
try {
  config = requireChain();
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(2);
}

const ok = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
let failures = 0;

console.log(`\nVerifying ${config.name} at ${config.rpcUrl}\n`);

// 1. Chain id.
try {
  const actual = Number(await rpc("eth_chainId"));
  if (actual === config.chainId) {
    console.log(ok(`chain id ${actual}`));
  } else {
    console.log(bad(`chain id is ${actual}, expected ${config.chainId}`));
    failures++;
  }
} catch (err) {
  console.log(bad(`RPC unreachable: ${err.message}`));
  process.exit(1);
}

// 2. Every address must be a contract.
console.log("\nBytecode:");
for (const [name, address] of addressManifest(config)) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.log(bad(`${name.padEnd(28)} ${address ?? "unset"} — not an address`));
    failures++;
    continue;
  }
  try {
    const code = await rpc("eth_getCode", [address, "latest"]);
    const size = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    if (size > 0) {
      console.log(ok(`${name.padEnd(28)} ${address}  ${size.toLocaleString()} bytes`));
    } else {
      console.log(bad(`${name.padEnd(28)} ${address}  NO CODE — wrong address or wrong chain`));
      failures++;
    }
  } catch (err) {
    console.log(bad(`${name.padEnd(28)} ${address}  ${err.message}`));
    failures++;
  }
}

// 3. USDG must behave like the token we think it is.
console.log("\nUSDG:");
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const decodeString = (hex) => {
  try {
    const len = Number(BigInt("0x" + hex.slice(66, 130)));
    return Buffer.from(hex.slice(130, 130 + len * 2), "hex").toString("utf8");
  } catch {
    return null;
  }
};

try {
  const symbol = decodeString(await call(config.usdg, "0x95d89b41"));
  const decimals = Number(BigInt(await call(config.usdg, "0x313ce567")));
  if (symbol === "USDG") console.log(ok(`symbol ${symbol}`));
  else {
    console.log(bad(`symbol is ${symbol ?? "unreadable"}, expected USDG`));
    failures++;
  }
  console.log(ok(`decimals ${decimals}`));
  if (decimals !== 6) {
    console.log(bad(`decimals ${decimals} — the code assumes 6; update it or the config`));
    failures++;
  }
} catch (err) {
  console.log(bad(`USDG did not answer: ${err.message}`));
  failures++;
}

// 4. The v3 factory should answer owner().
console.log("\nSanity:");
try {
  const owner = await call(config.uniswap.v3Factory, "0x8da5cb5b");
  if (owner && owner !== "0x") console.log(ok(`v3 factory owner() answers`));
  else {
    console.log(bad("v3 factory did not answer owner() — may not be a factory"));
    failures++;
  }
} catch (err) {
  console.log(bad(`v3 factory owner() failed: ${err.message}`));
  failures++;
}

// 5. Every canonical token must report the ticker the registry claims for it.
//    This is the check that catches a row transposed on the source page: the
//    checksum proves the address was copied correctly, only the chain proves it
//    was copied onto the right line.
const entries = Object.entries(ALL_TOKENS);
console.log(`\nCanonical token registry (${entries.length} tokens):`);
let mismatches = 0;
for (const [ticker, entry] of entries) {
  try {
    const symbol = decodeString(await call(entry.address, "0x95d89b41"));
    if (symbol === ticker) continue;
    console.log(bad(`${ticker.padEnd(8)} ${entry.address} reports symbol ${symbol ?? "?"}`));
    mismatches++;
    failures++;
  } catch (err) {
    console.log(bad(`${ticker.padEnd(8)} ${entry.address} ${err.message}`));
    mismatches++;
    failures++;
  }
}
if (mismatches === 0) {
  console.log(ok(`all ${entries.length} tokens report the expected symbol`));
}

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m Addresses are real contracts on this chain.\n"
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m Do not deploy against this configuration.\n`,
);
process.exit(failures === 0 ? 0 : 1);
