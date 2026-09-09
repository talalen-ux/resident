/**
 * Owner actions, as calldata to sign from your own wallet.
 *
 *   npm run owner -- rotate-keeper 0xNEW
 *   npm run owner -- set-venue 0xVENUE true
 *   npm run owner -- set-cap 0xUSDG 5000000000
 *   npm run owner -- withdraw 0xUSDG 0xYOU 1000000000
 *
 * This signs nothing and holds no key. It prints the destination, the value
 * and the calldata, which you paste into a hardware wallet, a Safe, or the
 * explorer's write tab.
 *
 * That is the point. The owner can withdraw every asset the vault holds, so it
 * is the one role that must never be a key on a server. The keeper is a hot key
 * in a container and the vault caps what it can do; the owner is a wallet in
 * your hand and is capped by nothing, which is exactly why the two are
 * different addresses and why this script exists instead of a seventh signer.
 */

import { Interface } from "ethers";

import { requireChain } from "../src/lib/chain.ts";

const VAULT = new Interface([
  "function rotateKeeper(address next)",
  "function transferOwnership(address next)",
  "function setVenue(address venue, bool allowed)",
  "function setBridge(address bridge, bool allowed)",
  "function setBridgeCap(address bridge, uint128 cap)",
  "function setCap(address asset, uint128 cap)",
  "function withdraw(address asset, address to, uint256 amount)",
]);

/** Every owner action, with what it does and what it cannot be undone by. */
const ACTIONS = {
  "rotate-keeper": {
    fn: "rotateKeeper",
    args: ["address"],
    usage: "rotate-keeper <newKeeper>",
    note: "Replaces the keeper. No assets move. Do this the moment a keeper key is in doubt.",
  },
  "transfer-ownership": {
    fn: "transferOwnership",
    args: ["address"],
    usage: "transfer-ownership <newOwner>",
    note: "IRREVERSIBLE from this side. The new owner can withdraw everything.",
  },
  "set-venue": {
    fn: "setVenue",
    args: ["address", "bool"],
    usage: "set-venue <venue> <true|false>",
    note: "Allowlists a venue for exec and approveVenue. Permit2 and the v4 position manager both need this before a mint can settle.",
  },
  "set-bridge": {
    fn: "setBridge",
    args: ["address", "bool"],
    usage: "set-bridge <bridge> <true|false>",
    note: "Allowlisting alone moves nothing: the cap starts at zero and is a second transaction.",
  },
  "set-bridge-cap": {
    fn: "setBridgeCap",
    args: ["address", "uint128"],
    usage: "set-bridge-cap <bridge> <capInMinorUnits>",
    note: "The rolling limit a keeper may send across this bridge.",
  },
  "set-cap": {
    fn: "setCap",
    args: ["address", "uint128"],
    usage: "set-cap <asset> <capInMinorUnits>",
    note: "The rolling 24h distribution limit for this asset.",
  },
  withdraw: {
    fn: "withdraw",
    args: ["address", "address", "uint256"],
    usage: "withdraw <asset> <to> <amountInMinorUnits>",
    note: "The power that makes this role the one to keep off a server.",
  },
};

const [name, ...rest] = process.argv.slice(2);
const action = ACTIONS[name];

if (!action) {
  console.error("Owner actions:\n");
  for (const a of Object.values(ACTIONS)) {
    console.error(`  ${a.usage.padEnd(46)} ${a.note}`);
  }
  console.error("\nNothing here signs. Each prints calldata to sign yourself.");
  process.exit(1);
}

if (rest.length !== action.args.length) {
  console.error(`usage: npm run owner -- ${action.usage}`);
  process.exit(1);
}

const parsed = rest.map((value, i) => {
  const type = action.args[i];
  if (type === "bool") {
    if (value !== "true" && value !== "false") {
      console.error(`argument ${i + 1} must be true or false, got ${value}`);
      process.exit(1);
    }
    return value === "true";
  }
  if (type === "address") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      console.error(`argument ${i + 1} is not an address: ${value}`);
      process.exit(1);
    }
    return value;
  }
  return BigInt(value);
});

const chain = requireChain();
const data = VAULT.encodeFunctionData(action.fn, parsed);

console.log(`
  ${action.note}

  Network   ${chain.name} (chain ${chain.chainId})
  To        ${chain.vault}
  Value     0
  Data      ${data}

  Paste that into your wallet's hex-data field, or open
  ${chain.explorer}/address/${chain.vault}?tab=write_contract
  and call ${action.fn} with:
${action.args.map((t, i) => `      ${t.padEnd(8)} ${rest[i]}`).join("\n")}

  Signed by the OWNER. If your keeper key is signing this, the two addresses
  are the same and the separation the vault enforces is not there.
`);
