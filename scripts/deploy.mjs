/**
 * The vault's deployment transaction, to sign from your own wallet.
 *
 *   npm run deploy -- <owner> <keeper> <payoutAsset>
 *
 * Compiles ResidentVault, appends the constructor arguments, and prints the
 * transaction. It signs nothing and needs no key, because the address that
 * deploys this contract becomes nothing: the OWNER is whichever address you
 * pass as the first argument, and that should be a wallet you hold rather than
 * whatever happens to be signing.
 *
 * The constructor is (owner, keeper, payoutAsset). Passing the same address
 * twice is refused here rather than discovered later: an owner that is also the
 * keeper collapses the separation the whole design rests on.
 */

import { Interface } from "ethers";

import { compile } from "../test/harness.mjs";
import { TOKENS } from "../src/lib/chain.ts";

const [owner, keeper, payoutAsset = TOKENS.usdg] = process.argv.slice(2);

const address = /^0x[0-9a-fA-F]{40}$/;
if (!address.test(owner ?? "") || !address.test(keeper ?? "")) {
  console.error(`
usage: npm run deploy -- <owner> <keeper> [payoutAsset]

  owner        a wallet you hold. Can withdraw everything, forever.
  keeper       the address from npm run newkey. Signs constantly, capped by
               the contract.
  payoutAsset  defaults to USDG ${TOKENS.usdg}
`);
  process.exit(1);
}

if (owner.toLowerCase() === keeper.toLowerCase()) {
  console.error(
    "\n  Refusing: the owner and the keeper are the same address.\n" +
      "  The keeper key lives on a server and the owner can withdraw everything.\n" +
      "  Making them one address means a stolen keeper key empties the vault.\n",
  );
  process.exit(1);
}

const { artifacts, warnings } = compile();
const artifact = artifacts.ResidentVault;
if (!artifact) {
  console.error("ResidentVault did not compile. Run npm run compile for the reason.");
  process.exit(1);
}
if (warnings.length) {
  console.error(`  ${warnings.length} compiler warning(s). Read them before deploying.`);
}
const bytecode = "0x" + artifact.bytecode;

const args = new Interface(artifact.abi).encodeDeploy([owner, keeper, payoutAsset]);
const data = bytecode + args.slice(2);

console.log(`
  ResidentVault deployment

  Owner        ${owner}
  Keeper       ${keeper}
  Payout asset ${payoutAsset}

  To           (leave empty: this creates a contract)
  Value        0
  Data         ${data.length} characters, written to deploy.hex

  Sign this from the wallet of your choice. Whoever signs it does NOT become
  the owner; the owner is the address above, set in the constructor.

  After it is mined:
    RESIDENT_VAULT=<the new contract address>
    npm run owner -- set-venue 0x000000000022D473030F116dDEE9F6B43aC78BA3 true   # Permit2
    npm run owner -- set-venue 0x58daec3116aae6d93017baaea7749052e8a04fa7 true   # v4 position manager
    npm run preflight
`);

const { writeFileSync } = await import("node:fs");
writeFileSync("deploy.hex", data + "\n");
