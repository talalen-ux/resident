/**
 * Claiming fees a launch holds in escrow.
 *
 * Some launchpads pay the fee recipient directly. Nothing here is needed for
 * those: the money arrives in the vault as ordinary balance and the next tick
 * deploys it. Others hold fees against a claim, and this is the two calls that
 * move them.
 *
 * The path:
 *
 *   1. The hook accrues fees per pool. A sweep splits them and credits the
 *      recipient's share into a shared escrow. The recipient may call it; the
 *      protocol's own sweep operator must, whenever the sweep would need an
 *      internal swap. We attempt it and let the revert stand: those cases
 *      belong to the operator, not to us.
 *
 *   2. The escrow holds a claimable balance per recipient, and claimToken
 *      pays it out.
 *
 * No escrow address is written down here. The hook exposes its escrow as an
 * immutable public, so it is read off the hook the desk is actually pointed
 * at. An address constant for something discoverable is an address constant
 * that can be wrong.
 *
 * One thing is inferred rather than read: the escrow implementation was not
 * published, only its interface, so "claimToken pays msg.sender" comes from
 * the shape of that interface — claim takes no recipient, and balances are
 * keyed by recipient. Rather than trust the inference, the keeper checks the
 * vault's balance actually rose. See verifyClaim.
 *
 * Provenance: the selectors below were derived from the interfaces published
 * at github.com/ponsdotdev/ponsfamily (contractsV2). That citation stays so
 * the signatures can be re-checked against their source; nothing in the desk
 * is tied to that venue, and a launchpad with the same interface works
 * unchanged.
 */

import { POSITION_SELECTORS, word } from "./position-reader.ts";
import type { UnsignedCall } from "./signer.ts";

/**
 * test/fee-escrow.test.mjs re-derives every one of these from its signature,
 * so a drift breaks the build rather than sending a call nothing answers.
 */
export const ESCROW_SELECTORS = {
  /** claimToken(address) */
  claimToken: "0x32f289cf",
  /** balanceOfToken(address,address) */
  balanceOfToken: "0xf59e38b7",
  /** sweepPoolFees(bytes32,uint256,uint256) */
  sweepPoolFees: "0x3d61055e",
  /** feeEscrow() */
  feeEscrow: "0xc4b7de97",
  /** pendingFees(bytes32,address) */
  pendingFees: "0x359b4f30",
  /** pendingCreatorTax(bytes32,address) */
  pendingCreatorTax: "0xc8eaa792",
} as const;

export type Call = (to: string, data: string) => Promise<string>;

const pad = (value: string) =>
  value.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const uint = (value: bigint) => pad(value.toString(16));
const big = (hex: string): bigint => (!hex || hex === "0x" ? 0n : BigInt(hex));

/** Where this hook credits claimable balances. Read, never configured. */
export async function escrowOf(call: Call, hook: string): Promise<string> {
  const result = await call(hook, ESCROW_SELECTORS.feeEscrow);
  return `0x${word(result, 0).slice(24)}`;
}

/** What the vault can claim out of the escrow right now, in raw units. */
export async function claimable(
  call: Call,
  escrow: string,
  vault: string,
  token: string,
): Promise<bigint> {
  return big(
    await call(
      escrow,
      ESCROW_SELECTORS.balanceOfToken + pad(vault) + pad(token),
    ),
  );
}

/**
 * Fees sitting on the hook that a sweep would move into the escrow.
 *
 * Both buckets, because they are paid together and either alone understates
 * what a sweep is worth. The creator tax is the launch's own, and the fee
 * bucket is split with the protocol, so this is an upper bound on what would
 * arrive rather than the exact figure.
 */
export async function pending(
  call: Call,
  hook: string,
  poolId: string,
  token: string,
): Promise<bigint> {
  const [fees, tax] = await Promise.all([
    call(hook, ESCROW_SELECTORS.pendingFees + pad(poolId) + pad(token)),
    call(hook, ESCROW_SELECTORS.pendingCreatorTax + pad(poolId) + pad(token)),
  ]);
  return big(fees) + big(tax);
}

/**
 * Move a pool's accrued fees into the escrow.
 *
 * Both minimums are zero, and that is safe here only because this call is made
 * when no internal conversion is needed: a sweep that has to swap reverts for
 * anyone but the protocol's own operator, so a zero minimum is never the slippage
 * bound on a swap this desk executed. If that ever changes, these must become
 * real bounds before this call is sent again.
 */
export function sweepCall(hook: string, poolId: string): UnsignedCall {
  return {
    to: hook,
    data: ESCROW_SELECTORS.sweepPoolFees + pad(poolId) + uint(0n) + uint(0n),
    description: `sweep pool fees into escrow for ${poolId.slice(0, 10)}`,
  };
}

/** Pay a claimable balance out to the caller. */
export function claimCall(escrow: string, token: string): UnsignedCall {
  return {
    to: escrow,
    data: ESCROW_SELECTORS.claimToken + pad(token),
    description: `claim ${token.slice(0, 10)} from the fee escrow`,
  };
}

/**
 * Did the claim actually land in the vault?
 *
 * The escrow's implementation is not published, so that claimToken pays
 * msg.sender is an inference from its interface. This turns the inference into
 * a check: if the balance did not rise, the claim went somewhere else and the
 * keeper must stop rather than journal income it does not hold.
 */
export async function verifyClaim(
  call: Call,
  token: string,
  vault: string,
  before: bigint,
): Promise<{ ok: boolean; received: bigint }> {
  const after = big(
    await call(token, POSITION_SELECTORS.balanceOf + pad(vault)),
  );
  const received = after > before ? after - before : 0n;
  return { ok: received > 0n, received };
}
