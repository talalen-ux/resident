/**
 * Claiming the launch's own fees back into the vault.
 *
 * This is the inflow the whole design exists to compound: the token's trading
 * fees become working capital that funds LP positions in other tokens. The
 * vault is the launch's creator fee recipient, so the fees are already the
 * desk's; what is missing is the two calls that move them.
 *
 * The path, from ponsdotdev/ponsfamily contractsV2:
 *
 *   1. PonsV2MemeHook accrues fees per pool in pendingFees[poolId][currency].
 *      sweepPoolFees splits them and credits the creator's share into a shared
 *      escrow. The creator may call it; the protocol's sweep operator must,
 *      whenever the sweep would need an internal swap (memecoin-denominated
 *      fees, or a pending buyback earmark). We attempt it and let the revert
 *      stand: those cases belong to Pons's operator, not to us.
 *
 *   2. IPonsV2FeeEscrow holds a claimable balance per recipient.
 *      claimToken(token) pays it out.
 *
 * No escrow address is written down here. The hook exposes its escrow as an
 * immutable public, so it is read from the hook the desk is actually pointed
 * at. An address constant for something discoverable is an address constant
 * that can be wrong.
 *
 * One thing is inferred rather than read: the escrow implementation is not in
 * that repository, only its interface, so "claimToken pays msg.sender" comes
 * from the shape of the interface — claim takes no recipient, and balances are
 * keyed by recipient. Rather than trust the inference, the keeper checks the
 * vault's balance actually rose. See verifyClaim.
 */

import { POSITION_SELECTORS, word } from "./position-reader.ts";
import type { UnsignedCall } from "./signer.ts";

/**
 * Selectors, derived from the signatures in ILaunchpadV2.sol and
 * PonsV2MemeHook.sol. test/pons.test.mjs re-derives each one, so a drift breaks
 * the build rather than sending a call nothing answers.
 */
export const PONS_SELECTORS = {
  /** IPonsV2FeeEscrow.claimToken(address) */
  claimToken: "0x32f289cf",
  /** IPonsV2FeeEscrow.balanceOfToken(address,address) */
  balanceOfToken: "0xf59e38b7",
  /** PonsV2MemeHook.sweepPoolFees(bytes32,uint256,uint256) */
  sweepPoolFees: "0x3d61055e",
  /** PonsV2MemeHook.feeEscrow() */
  feeEscrow: "0xc4b7de97",
  /** PonsV2MemeHook.pendingFees(bytes32,address) */
  pendingFees: "0x359b4f30",
  /** PonsV2MemeHook.pendingCreatorTax(bytes32,address) */
  pendingCreatorTax: "0xc8eaa792",
} as const;

export type Call = (to: string, data: string) => Promise<string>;

const pad = (value: string) =>
  value.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const uint = (value: bigint) => pad(value.toString(16));
const big = (hex: string): bigint => (!hex || hex === "0x" ? 0n : BigInt(hex));

/** Where this hook credits claimable balances. Read, never configured. */
export async function escrowOf(call: Call, hook: string): Promise<string> {
  const result = await call(hook, PONS_SELECTORS.feeEscrow);
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
      PONS_SELECTORS.balanceOfToken + pad(vault) + pad(token),
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
    call(hook, PONS_SELECTORS.pendingFees + pad(poolId) + pad(token)),
    call(hook, PONS_SELECTORS.pendingCreatorTax + pad(poolId) + pad(token)),
  ]);
  return big(fees) + big(tax);
}

/**
 * Move a pool's accrued fees into the escrow.
 *
 * Both minimums are zero, and that is safe here only because this call is made
 * when no internal conversion is needed: a sweep that has to swap reverts for
 * anyone but Pons's own operator, so a zero minimum can never be the slippage
 * bound on a swap this desk executed. If that ever changes, these must become
 * real bounds before this call is sent again.
 */
export function sweepCall(hook: string, poolId: string): UnsignedCall {
  return {
    to: hook,
    data: PONS_SELECTORS.sweepPoolFees + pad(poolId) + uint(0n) + uint(0n),
    description: `sweep pool fees into escrow for ${poolId.slice(0, 10)}`,
  };
}

/** Pay a claimable balance out to the caller. */
export function claimCall(escrow: string, token: string): UnsignedCall {
  return {
    to: escrow,
    data: PONS_SELECTORS.claimToken + pad(token),
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
