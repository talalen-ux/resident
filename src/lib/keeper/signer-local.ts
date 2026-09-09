/**
 * A keeper key held by the process, with the guardrails that makes acceptable.
 *
 * No KMS, no HSM, no signing service. The key sits in the environment and this
 * signs with it. That is a real trade and worth stating plainly rather than
 * hiding behind an abstraction: anyone who can read the process environment can
 * take this key.
 *
 * WHAT A STOLEN KEEPER KEY CAN AND CANNOT DO
 *
 * The vault is what makes the trade survivable. Read from ResidentVault.sol,
 * the keeper may call exactly six things: exec, approveVenue, bridgeOut,
 * recordRealized, absorbLoss, distribute. Everything that could empty the vault
 * is onlyOwner:
 *
 *   withdraw            owner only
 *   setVenue, setBridge owner only, so no new destination can be added
 *   setCap, setBridgeCap owner only, so no limit can be raised
 *   rotateKeeper        owner only, and moves no assets when used
 *
 * So a stolen keeper key cannot take the money. It can still LOSE it: exec
 * reaches every allowlisted venue, and nothing stops it opening deliberately
 * terrible positions. Size the vault to what you would accept losing to a
 * compromised container, and keep the owner somewhere this key is not.
 *
 * That owner should be a wallet you hold. `npm run owner` prints the calldata
 * for every owner action so it can be signed from a hardware wallet, which
 * means the powerful half of this system never has a key on a server at all.
 */

import { Transaction, Wallet } from "ethers";

import { MAINNET } from "../chain.ts";
import { RpcSigner, type Eip1559Fields, type FeePolicy, type Rpc } from "./tx.ts";
import type { Signer } from "./signer.ts";

export type LocalSignerOptions = {
  rpc: Rpc;
  /** 32-byte hex. Never logged, never included in an error. */
  key: string;
  /** Refuse to sign for any other chain. Read from the node, not assumed. */
  expectedChainId?: number;
  /**
   * Permit signing on Robinhood Chain mainnet.
   *
   * Off by default. A hot key is a reasonable way to run a testnet desk and a
   * deliberate decision to run a live one, so the deliberate decision has to be
   * made somewhere, and an environment variable is somewhere.
   */
  allowMainnet?: boolean;
  fees?: FeePolicy;
};

/** Thrown for anything wrong with the key itself. Never carries the key. */
export class KeyRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRejected";
  }
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Build a signer around a raw key.
 *
 * The key is validated for shape before a Wallet is constructed, because
 * ethers' own error for a malformed key includes the value it was given, and
 * that value ends up in a log.
 */
export function localSigner(options: LocalSignerOptions): Signer {
  const key = options.key?.trim();
  if (!key) {
    throw new KeyRejected(
      "no keeper key supplied. Set RESIDENT_KEEPER_KEY, or leave it unset to " +
        "run as a dry run, which builds every call and sends none of them.",
    );
  }
  if (!HEX32.test(key)) {
    throw new KeyRejected(
      "the keeper key is not 32 bytes of hex with an 0x prefix. " +
        "The value is deliberately not echoed here.",
    );
  }

  const wallet = new Wallet(key);
  const address = wallet.address;

  return new RpcSigner({
    rpc: options.rpc,
    from: address,
    fees: options.fees,
    description: `local key ${address}`,
    sign: async (tx: Eip1559Fields) => {
      guardChain(tx.chainId, options);
      return signEip1559(wallet, tx);
    },
  });
}

/**
 * Refuse to sign for a chain this signer was not meant for.
 *
 * Checked per transaction rather than once at startup, because the chain id
 * comes from the node and an RPC URL can be repointed under a running process.
 * A keeper that follows its RPC onto mainnet is the failure this prevents.
 */
export function guardChain(chainId: number, options: LocalSignerOptions): void {
  if (options.expectedChainId !== undefined && chainId !== options.expectedChainId) {
    throw new KeyRejected(
      `the node reports chain ${chainId}, and this signer was configured for ` +
        `${options.expectedChainId}. Refusing to sign.`,
    );
  }
  if (chainId === MAINNET.chainId && !options.allowMainnet) {
    throw new KeyRejected(
      `chain ${chainId} is ${MAINNET.name} mainnet and this is a key held in ` +
        "the process. Set RESIDENT_ALLOW_MAINNET=1 to say that is intended, " +
        "and read the note at the top of signer-local.ts first.",
    );
  }
}

/** Sign an assembled transaction. Separated so it can be tested on its own. */
export async function signEip1559(
  wallet: Wallet,
  tx: Eip1559Fields,
): Promise<string> {
  return wallet.signTransaction(
    Transaction.from({
      type: 2,
      chainId: tx.chainId,
      nonce: tx.nonce,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gasLimit: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    }),
  );
}

/**
 * The address a key controls, for checking against the vault before funding.
 *
 * Takes the key and returns only the address, so the one place an operator
 * needs to see what a key IS never has to print the key itself.
 */
export function addressOf(key: string): string {
  if (!HEX32.test(key?.trim() ?? "")) {
    throw new KeyRejected("not a 32-byte hex key; the value is not echoed.");
  }
  return new Wallet(key.trim()).address;
}
