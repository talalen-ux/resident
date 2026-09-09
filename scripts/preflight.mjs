/**
 * Everything that must be true before the vault holds money.
 *
 *   RESIDENT_RPC_URL=... RESIDENT_VAULT=0x... \
 *     node --experimental-strip-types scripts/preflight.mjs
 *
 * Reads only. It signs nothing, needs no key, and changes nothing — so it is
 * safe to run against a live deployment as often as you like.
 *
 * Exit code is non-zero if any check fails, so it can gate a funding
 * transaction in a script rather than relying on someone reading the output.
 *
 * The ABI comes from compiling the contract in this repo, not from a
 * hand-written selector table. If the deployed vault does not answer these,
 * the deployment and this source are not the same contract — which is exactly
 * what you want to find out before sending it money rather than after.
 */

import { Interface } from "ethers";

import { compile } from "../test/harness.mjs";
import { UNISWAP, requireChain } from "../src/lib/chain.ts";

const ok = (m) => `  \x1b[32m✓\x1b[0m ${m}`;
const bad = (m) => `  \x1b[31m✗\x1b[0m ${m}`;
const warn = (m) => `  \x1b[33m!\x1b[0m ${m}`;

let failures = 0;
let warnings = 0;
const fail = (m) => { console.log(bad(m)); failures++; };
const flag = (m) => { console.log(warn(m)); warnings++; };

let config;
try {
  config = requireChain();
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}

const { artifacts } = compile();
const iface = new Interface(artifacts.ResidentVault.abi);

async function rpc(method, params = []) {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function read(name, args = []) {
  const data = iface.encodeFunctionData(name, args);
  const raw = await rpc("eth_call", [{ to: config.vault, data }, "latest"]);
  const [value] = iface.decodeFunctionResult(name, raw);
  return value;
}

console.log(`\nPreflight — ${config.name}\n  vault ${config.vault}\n`);

// --- the vault is there, and it is this contract ---------------------------
console.log("Deployment:");
try {
  const code = await rpc("eth_getCode", [config.vault, "latest"]);
  if (!code || code === "0x") {
    fail("no bytecode at RESIDENT_VAULT — wrong address or wrong chain");
    console.log("\nNothing else can be checked. Stopping.\n");
    process.exit(1);
  }
  console.log(ok(`bytecode present, ${((code.length - 2) / 2).toLocaleString()} bytes`));
} catch (err) {
  fail(`could not reach the chain: ${err.message}`);
  process.exit(1);
}

// --- custody ----------------------------------------------------------------
console.log("\nCustody:");
let owner, keeper;
try {
  owner = await read("owner");
  keeper = await read("keeper");
  console.log(ok(`owner  ${owner}`));
  console.log(ok(`keeper ${keeper}`));

  if (owner.toLowerCase() === keeper.toLowerCase()) {
    fail("owner and keeper are the same address — one compromised key loses everything");
  }
  if (process.env.RESIDENT_EXPECTED_OWNER &&
      owner.toLowerCase() !== process.env.RESIDENT_EXPECTED_OWNER.toLowerCase()) {
    fail(`owner is not RESIDENT_EXPECTED_OWNER`);
  }
} catch (err) {
  fail(`could not read owner/keeper: ${err.message}`);
}

flag("the owner can withdraw everything, with no timelock. Confirm who holds that key and on what hardware");

// --- the split --------------------------------------------------------------
console.log("\nLedger:");
try {
  const bps = await read("HOLDER_BPS");
  if (Number(bps) === 1500) console.log(ok("holder share 15%"));
  else fail(`HOLDER_BPS is ${bps}, expected 1500 — the deployed contract is not this source`);

  const realized = await read("realized");
  const distributed = await read("distributed");
  if (realized === 0n && distributed === 0n) {
    console.log(ok("ledger is zeroed — a fresh deployment"));
  } else {
    flag(`ledger already carries realized ${realized}, distributed ${distributed}`);
  }
} catch (err) {
  fail(`could not read the ledger: ${err.message}`);
}

// --- payout asset -----------------------------------------------------------
console.log("\nPayout asset:");
try {
  const asset = await read("payoutAsset");
  if (asset.toLowerCase() === config.usdg.toLowerCase()) {
    console.log(ok(`USDG ${asset}`));
  } else {
    fail(`payoutAsset is ${asset}, config USDG is ${config.usdg}`);
  }
} catch (err) {
  fail(`could not read payoutAsset: ${err.message}`);
}

// --- limits -----------------------------------------------------------------
console.log("\nLimits:");
try {
  const remaining = await read("rateLimitRemaining", [config.usdg]);
  if (remaining > 0n) {
    console.log(ok(`distribution cap set, ${remaining} remaining this window`));
  } else {
    fail("distribution cap is zero — holders cannot be paid until setCap runs");
  }
} catch (err) {
  fail(`could not read the distribution cap: ${err.message}`);
}

const bridges = (process.env.RESIDENT_BRIDGES ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!bridges.length) {
  console.log(ok("no bridges configured — capital cannot leave this chain"));
} else {
  for (const bridge of bridges) {
    try {
      const allowed = await read("isBridge", [bridge]);
      const cap = await read("bridgeLimitRemaining", [bridge]);
      if (!allowed) flag(`${bridge} is not allowlisted, so its cap is inert`);
      else if (cap === 0n) flag(`${bridge} is allowlisted but its cap is zero — it moves nothing`);
      else console.log(ok(`${bridge} allowed, ${cap} per window`));
      if (allowed && cap > 0n) {
        flag(`${bridge} can move value beyond this contract's reach. Cap it at what you would accept losing`);
      }
    } catch (err) {
      fail(`could not read bridge ${bridge}: ${err.message}`);
    }
  }
}

// --- venues -----------------------------------------------------------------
console.log("\nVenues:");
const venues = (process.env.RESIDENT_VENUES ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
if (!venues.length) {
  flag("RESIDENT_VENUES not set — cannot confirm the keeper has anywhere to trade");
} else {
  for (const venue of venues) {
    try {
      const allowed = await read("isVenue", [venue]);
      if (allowed) console.log(ok(`${venue} allowlisted`));
      else fail(`${venue} is NOT allowlisted — exec will revert on it`);
    } catch (err) {
      fail(`could not read venue ${venue}: ${err.message}`);
    }
  }
}

// --- what a v4 mint needs, specifically -------------------------------------
//
// The position manager does not pull tokens with a plain ERC20 allowance. It
// calls permit2.transferFrom(payer, poolManager, amount, token), so the vault
// has to be able to call BOTH: Permit2, to grant it an allowance, and the
// position manager, to mint. Miss either and the mint reverts after the gas is
// spent, which is a failure that looks like a bug in the encoding.
console.log("\nUniswap v4:");
for (const [label, address] of [
  ["Permit2", process.env.RESIDENT_PERMIT2 ?? UNISWAP.permit2],
  ["v4 position manager", process.env.RESIDENT_V4_POSITION_MANAGER ?? UNISWAP.v4PositionManager],
]) {
  try {
    const allowed = await read("isVenue", [address]);
    if (allowed) console.log(ok(`${label} ${address} allowlisted`));
    else fail(`${label} ${address} is NOT allowlisted — every mint will revert`);
  } catch (err) {
    fail(`could not read ${label}: ${err.message}`);
  }
}

// --- the thing no chain call can answer -------------------------------------
console.log("\nOff-chain:");
flag("the keeper runs but signs nothing: no signing service is configured in this repository");
flag("the contracts have not been audited");

console.log(
  `\n${failures} failed, ${warnings} to confirm.\n` +
    (failures
      ? "Do NOT fund this vault.\n"
      : "No blocking failures. Read every line above before sending funds.\n"),
);
process.exit(failures ? 1 : 0);
