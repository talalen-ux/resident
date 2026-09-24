/**
 * The bonding curve, which is where a launch's first fees actually are.
 *
 * `fee-escrow.ts` claims fees off the hook. The hook only exists after the launch
 * graduates into a Uniswap v4 pool. Before that, every trade happens on
 * the launch's bonding curve, and its fees sit in two balances on it:
 *
 *   quoteFeeBalance    the base fee, split protocol / buyback / creator
 *   creatorTaxBalance  the creator tax, paid to the creator in full
 *
 * Neither reaches the escrow until somebody calls `sweepFees`. So a keeper
 * that only knows about the hook watches day one go by with an inflow of zero
 * and nothing wrong: the fees are real, they are ours, and they are on a
 * contract nobody has asked to pay out. That is the entire reason this file
 * exists.
 *
 * Who may call it:
 *
 *   if (!isOperator && msg.sender != deployer) revert NotFeeSweepOperator();
 *   if (!isOperator && _requiresTrustedOperator()) revert InternalSwapRequiresOperator();
 *
 * Two things follow, and both are load-bearing.
 *
 * `deployer` is not the wallet that launched. It is the creator fee recipient,
 * and `setCreatorFeeRecipient` assigns straight to it. So pointing the launch's
 * fees at the vault does not only redirect the payout — it makes the vault the
 * address allowed to sweep. One factory call buys both.
 *
 * `_requiresTrustedOperator()` is `buybackQuoteBalance != 0`. A launch with
 * buyback-and-lock enabled earmarks a slice of every creator fee for an
 * internal swap, and that swap is the protocol's to price, not ours. While that
 * balance is non-zero the sweep is theirs alone and ours reverts. With buyback
 * disabled at launch it stays zero and the vault sweeps its own fees on its own
 * schedule. That is a launch-configuration decision with a direct operational
 * consequence, which is why it is read here rather than assumed either way.
 */

import { word } from "./position-reader.ts";
import type { UnsignedCall } from "./signer.ts";

/**
 * test/curve.test.mjs re-derives each one from its signature.
 */
export const CURVE_SELECTORS = {
  /** sweepFees(uint256 minBuybackTokensOut) */
  sweepFees: "0x3729bb9a",
  /** quoteFeeBalance() */
  quoteFeeBalance: "0xed479c47",
  /** creatorTaxBalance() */
  creatorTaxBalance: "0xdb2bd533",
  /** buybackQuoteBalance() — non-zero means only the protocol may sweep */
  buybackQuoteBalance: "0x7809452a",
  /** graduated() */
  graduated: "0xe7c2b772",
  /** deployer() — the creator fee recipient, and the only address that may sweep */
  deployer: "0xd5f39488",
  /** pairToken() — the quote asset fees accrue in */
  pairToken: "0x3de35b79",
} as const;

export type Call = (to: string, data: string) => Promise<string>;

const big = (result: string) => BigInt(`0x${word(result, 0)}`);

export type CurveState = {
  /** Base fee pending. Split protocol / buyback / creator on sweep. */
  quoteFees: bigint;
  /** Creator tax pending. Paid to the creator in full. */
  creatorTax: bigint;
  /** Everything pending, before the split. */
  pending: bigint;
  /** True once trading has moved to a v4 pool. The curve is finished. */
  graduated: boolean;
  /** Who may sweep. Should be the vault. */
  deployer: string;
  /**
   * True when a buyback slice is earmarked, which makes the sweep the protocol's
   * alone. Not a fault: the fees stay pending and arrive later.
   */
  operatorOnly: boolean;
};

/** Everything the sweep decision needs, in one round of reads. */
export async function curveState(call: Call, curve: string): Promise<CurveState> {
  const [quote, tax, buyback, graduated, deployer] = await Promise.all([
    call(curve, CURVE_SELECTORS.quoteFeeBalance).then(big),
    call(curve, CURVE_SELECTORS.creatorTaxBalance).then(big),
    call(curve, CURVE_SELECTORS.buybackQuoteBalance).then(big),
    call(curve, CURVE_SELECTORS.graduated).then(big),
    call(curve, CURVE_SELECTORS.deployer).then((r) => `0x${word(r, 0).slice(24)}`),
  ]);
  return {
    quoteFees: quote,
    creatorTax: tax,
    pending: quote + tax,
    graduated: graduated !== 0n,
    deployer,
    operatorOnly: buyback !== 0n,
  };
}

export type CurveSweepDecision =
  | { sweep: true; call: UnsignedCall }
  | { sweep: false; reason: string };

/**
 * Whether to sweep the curve now.
 *
 * The floor is the same one a position sweep uses: a sweep that costs more gas
 * than it moves is a loss dressed as diligence. Everything else here is a
 * reason the call would revert, checked before spending the gas to find out.
 */
export function curveSweep(
  curve: string,
  state: CurveState,
  vault: string,
  minimum: bigint,
): CurveSweepDecision {
  if (state.graduated) {
    return { sweep: false, reason: "graduated — fees are on the hook now" };
  }
  if (state.deployer.toLowerCase() !== vault.toLowerCase()) {
    return {
      sweep: false,
      reason:
        `the curve pays ${state.deployer}, not the vault — ` +
        "point the launch fees at the vault first",
    };
  }
  if (state.operatorOnly) {
    return {
      sweep: false,
      reason: "a buyback slice is earmarked, so this sweep is the protocol's to make",
    };
  }
  if (state.pending < minimum) {
    return { sweep: false, reason: `${state.pending} pending, under the floor` };
  }
  return { sweep: true, call: curveSweepCall(curve) };
}

/**
 * The sweep call.
 *
 * `minBuybackTokensOut` is the output floor on the internal buyback swap. We
 * only ever send this when no buyback is earmarked, so no swap executes and
 * the floor is not reached — zero is correct here and is not an unbounded
 * slippage setting. If that ever stops being true the call reverts on
 * `InternalSwapRequiresOperator` before the floor is consulted, which is the
 * right failure and not a silent bad fill.
 */
export function curveSweepCall(curve: string): UnsignedCall {
  return {
    to: curve,
    data: `${CURVE_SELECTORS.sweepFees}${"0".repeat(64)}`,
    description: `sweep launch fees from the bonding curve ${curve}`,
  };
}
