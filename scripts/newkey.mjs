/**
 * Generate a keeper key.
 *
 *   npm run newkey
 *
 * Prints a fresh private key and the address it controls, once, and stores
 * nothing. Copy the key straight into Railway and close the terminal.
 *
 * Use a key generated here rather than one exported from a wallet you already
 * hold. The keeper key lives in a container and is the one that can be taken;
 * a key that has never been anything else has nothing else to lose.
 */

import { Wallet } from "ethers";

const wallet = Wallet.createRandom();

console.log(`
  A new keeper key. This is the only time it is shown.

  Address     ${wallet.address}
  Private key ${wallet.privateKey}

  Next:
    1. Paste the private key into Railway as RESIDENT_KEEPER_KEY.
    2. Deploy the vault with this ADDRESS as the keeper, and a wallet you
       hold as the owner. They must not be the same address.
    3. Send this address a small amount of gas. It never needs anything else:
       every asset stays in the vault.

  Do not put this key in a file, a password manager shared with anyone, or a
  git repository. If it leaks, rotate it: npm run owner -- rotate-keeper 0xNEW
`);
