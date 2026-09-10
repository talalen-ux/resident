/**
 * The vault's own state, read from the chain.
 *
 * Selectors are imported from the dashboard adapter rather than restated here.
 * test/selectors.test.mjs asserts every one of them against the compiled
 * contract, so a signature change breaks the build; a second copy in this file
 * would be a second thing to forget.
 */

import { SELECTORS } from "../desk/selectors.ts";
import { POSITION_SELECTORS, word } from "./position-reader.ts";
import { toUnits } from "./observer.ts";

export type Call = (to: string, data: string) => Promise<string>;

const big = (hex: string): bigint => (!hex || hex === "0x" ? 0n : BigInt(hex));
const addressFrom = (hex: string): string => `0x${word(hex, 0).slice(24)}`;

export type VaultRoles = { owner: string; keeper: string; payoutAsset: string };

/**
 * Who may do what.
 *
 * The loop checks the signer against these every tick and halts if the keeper
 * is the owner or is not the registered keeper. Reading them once at startup
 * would miss a rotation, which is the one moment the answer changes.
 */
export async function readVaultRoles(call: Call, vault: string): Promise<VaultRoles> {
  const [owner, keeper, payoutAsset] = await Promise.all([
    call(vault, SELECTORS.owner),
    call(vault, SELECTORS.keeper),
    call(vault, SELECTORS.payoutAsset),
  ]);
  return {
    owner: addressFrom(owner),
    keeper: addressFrom(keeper),
    payoutAsset: addressFrom(payoutAsset),
  };
}

export type VaultLedger = {
  /** Realised profit booked into the contract, in quote units. */
  realized: number;
  /** The retained 85%, less losses. */
  workingCapital: number;
  /** Paid to holders so far. */
  distributed: number;
  /** Accrued to holders and not yet paid. Drives the distribute rule. */
  owed: number;
};

export async function readVaultLedger(
  call: Call,
  vault: string,
  decimals: number,
): Promise<VaultLedger> {
  const [realized, workingCapital, distributed, owed] = await Promise.all([
    call(vault, SELECTORS.realized),
    call(vault, SELECTORS.workingCapital),
    call(vault, SELECTORS.distributed),
    call(vault, SELECTORS.owed),
  ]);
  return {
    realized: toUnits(big(realized), decimals),
    workingCapital: toUnits(big(workingCapital), decimals),
    distributed: toUnits(big(distributed), decimals),
    owed: toUnits(big(owed), decimals),
  };
}

/** ERC20 balance of a holder, in raw units. */
export async function readBalance(
  call: Call,
  token: string,
  holder: string,
): Promise<bigint> {
  const data =
    POSITION_SELECTORS.balanceOf +
    holder.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return big(await call(token, data));
}

/**
 * Loose tokens the vault holds that are not the quote asset.
 *
 * These are what the ladder rule places. A token sitting in the vault is not
 * doing anything: it was swept out of a position, or arrived as a fee, and
 * until it is sold or laddered it earns nothing and carries full price risk.
 */
export async function readInventory(
  call: Call,
  vault: string,
  tokens: Array<{ pool: string; address: string; decimals: number; price: number }>,
): Promise<Array<{ pool: string; quantity: number; price: number }>> {
  const balances = await Promise.all(
    tokens.map((token) => readBalance(call, token.address, vault).catch(() => 0n)),
  );
  const inventory: Array<{ pool: string; quantity: number; price: number }> = [];
  balances.forEach((raw, index) => {
    const token = tokens[index];
    const quantity = toUnits(raw, token.decimals);
    // A dust balance is not inventory. Laddering it costs more gas than the
    // tokens are worth, and it would show up as a decision every tick.
    if (quantity * token.price < 1) return;
    inventory.push({ pool: token.pool, quantity, price: token.price });
  });
  return inventory;
}
