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
import { escrowOf } from "../src/lib/keeper/fee-escrow.ts";
import { feesPointAt, launchOf } from "../src/lib/keeper/launch.ts";
import { curveState, curveSweep } from "../src/lib/keeper/curve.ts";

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

// The router is needed on both legs of the desk's life, which is why it is a
// failure rather than a warning.
//
// Entering: a range that straddles spot is funded with both tokens, and the
// treasury holds one. Every two-sided open buys the other side through this
// router first, so without it no position opens at all.
//
// Exiting: fees arrive as whatever the pool charges them in. Without the
// router they are never sold back, and the treasury quietly becomes a
// portfolio of the tokens it has been making markets in.
{
  const router = process.env.RESIDENT_UNIVERSAL_ROUTER ?? UNISWAP.universalRouter;
  try {
    const allowed = await read("isVenue", [router]);
    if (allowed) console.log(ok(`UniversalRouter ${router} allowlisted`));
    else fail(`UniversalRouter ${router} is NOT allowlisted — no two-sided position can be opened`);
  } catch (err) {
    fail(`could not read UniversalRouter: ${err.message}`);
  }
}

// --- the launch's own fees --------------------------------------------------
//
// Two separate things have to be true for a single dollar of $RES trading fees
// to reach the vault, and neither of them reverts when it is wrong.
//
//   1. The launch's creator fee recipient must BE the vault. If it is not, the
//      fees are real, they are being paid, and they are going somewhere else.
//   2. The hook and its escrow must be allowlisted, or the claim the keeper
//      builds every tick reverts on the vault's own guard.
//
// Both are checked only when configured. A desk that has not launched yet is
// not misconfigured; it is early.
console.log("\nThe launch:");
const launchHook = process.env.RESIDENT_LAUNCH_HOOK;
const launchFactory = process.env.RESIDENT_LAUNCH_FACTORY;
const resToken = process.env.RESIDENT_TOKEN;

if (!launchFactory) {
  // Not a fault. The vault takes fees as ordinary balance, so a launch that
  // pays its fee recipient needs nothing here; these checks are for the
  // narrower case of fees held in escrow until claimed.
  flag("RESIDENT_LAUNCH_FACTORY not set — launch fees are expected to arrive as plain balance");
} else if (!resToken) {
  flag("RESIDENT_TOKEN not set — cannot confirm the launch pays this vault");
} else {
  try {
    const record = await launchOf(
      (to, data) => rpc("eth_call", [{ to, data }, "latest"]),
      launchFactory,
      resToken,
    );
    if (!record.exists) {
      fail(`${launchFactory} has no launch record for ${resToken} — wrong token address, or the wrong factory`);
    } else if (feesPointAt(record, config.vault)) {
      console.log(ok(`fees pay the vault (${record.phase}, ${record.creatorTaxBps} bps creator tax)`));

      // Before graduation the fees are on the curve, and pointing them at the
      // vault also made the vault the only address allowed to sweep — unless
      // a buyback slice is earmarked, which hands that right to the protocol.
      // Neither loses money. One means the keeper sweeps on its own schedule;
      // the other means it waits on theirs, which on a launch's first day is
      // the difference between compounding today and compounding whenever.
      if (record.phase === "not graduated") {
        const state = await curveState(
          (to, data) => rpc("eth_call", [{ to, data }, "latest"]),
          record.curve,
        );
        const decision = curveSweep(record.curve, state, config.vault, 0n);
        if (decision.sweep) {
          console.log(ok(`the vault may sweep its own curve fees (${state.pending} pending)`));
        } else {
          flag(`curve fees are not the vault's to sweep: ${decision.reason}`);
        }
      }
    } else {
      fail(
        `fees pay ${record.creatorFeeRecipient}, NOT the vault — ` +
          "every fee this token earns is going elsewhere",
      );
      console.log(`      fix: npm run owner -- point-launch-fees ${resToken}`);
      console.log("      sign it from the wallet that currently receives them");
    }
  } catch (err) {
    fail(`could not read the launch record: ${err.message}`);
  }
}

if (launchFactory && !launchHook) {
  flag("RESIDENT_LAUNCH_HOOK not set — the keeper will not claim fees once the launch graduates");
} else if (launchHook) {
  try {
    const escrow = await escrowOf(
      (to, data) => rpc("eth_call", [{ to, data }, "latest"]),
      launchHook,
    );
    for (const [label, address] of [["launch hook", launchHook], ["fee escrow", escrow]]) {
      const allowed = await read("isVenue", [address]);
      if (allowed) console.log(ok(`${label} ${address} allowlisted`));
      else fail(`${label} ${address} is NOT allowlisted — the claim will revert every tick`);
    }
  } catch (err) {
    fail(`could not read the hook's escrow: ${err.message}`);
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
