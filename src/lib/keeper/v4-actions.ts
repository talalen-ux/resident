/**
 * Calldata for the Uniswap v4 position manager.
 *
 * v4 does not expose mint/collect/burn as functions. Every position operation
 * goes through one entry point, `modifyLiquidities(bytes unlockData, uint256
 * deadline)`, where unlockData is an ABI-encoded pair: a byte string of action
 * codes and an array of parameter blobs, one per action. What would be three
 * calls in v3 is one call whose meaning is entirely in that encoding.
 *
 * The action codes and parameter tuples here are transcribed from
 * @uniswap/v4-periphery 1.0.3: src/libraries/Actions.sol for the codes, and
 * PositionManager._handleAction for the tuple each one decodes. They are
 * checked against a round trip in the tests rather than trusted, because a
 * wrong code does not fail loudly; it performs a different action.
 *
 * WHAT PAYS
 *
 * The position manager does not pull tokens with a plain ERC20 allowance. It
 * calls `permit2.transferFrom(payer, poolManager, amount, token)`, so a payer
 * has to have approved Permit2 on the token AND granted Permit2 an allowance
 * for the position manager. For this desk the payer is the vault, which means
 * both Permit2 and the position manager have to be allowlisted venues before a
 * mint can settle. Preflight checks for exactly that.
 */

import { AbiCoder } from "ethers";
import type { PoolKey } from "../sim/v4.ts";

const abi = AbiCoder.defaultAbiCoder();

/** Action codes, from Actions.sol. */
export const ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
} as const;

/** `modifyLiquidities(bytes,uint256)`. */
export const MODIFY_LIQUIDITIES_SELECTOR = "0xdd46508f";

const POOL_KEY = "(address,address,uint24,int24,address)";

const poolKeyTuple = (key: PoolKey) => [
  key.currency0,
  key.currency1,
  key.fee,
  key.tickSpacing,
  key.hooks,
];

/** One action and the parameters it decodes. */
export type Action = { code: number; params: string };

export function mintPosition(args: {
  key: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  /** Most of each token the mint may take. A slippage bound, not an estimate. */
  amount0Max: bigint;
  amount1Max: bigint;
  owner: string;
  hookData?: string;
}): Action {
  return {
    code: ACTIONS.MINT_POSITION,
    params: abi.encode(
      [POOL_KEY, "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"],
      [
        poolKeyTuple(args.key),
        args.tickLower,
        args.tickUpper,
        args.liquidity,
        args.amount0Max,
        args.amount1Max,
        args.owner,
        args.hookData ?? "0x",
      ],
    ),
  };
}

export function decreaseLiquidity(args: {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  hookData?: string;
}): Action {
  return {
    code: ACTIONS.DECREASE_LIQUIDITY,
    params: abi.encode(
      ["uint256", "uint256", "uint128", "uint128", "bytes"],
      [args.tokenId, args.liquidity, args.amount0Min, args.amount1Min, args.hookData ?? "0x"],
    ),
  };
}

export function burnPosition(args: {
  tokenId: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  hookData?: string;
}): Action {
  return {
    code: ACTIONS.BURN_POSITION,
    params: abi.encode(
      ["uint256", "uint128", "uint128", "bytes"],
      [args.tokenId, args.amount0Min, args.amount1Min, args.hookData ?? "0x"],
    ),
  };
}

/** Pay whatever the actions above owe the pool, in both currencies. */
export function settlePair(currency0: string, currency1: string): Action {
  return {
    code: ACTIONS.SETTLE_PAIR,
    params: abi.encode(["address", "address"], [currency0, currency1]),
  };
}

/** Collect whatever the actions above are owed, in both currencies. */
export function takePair(
  currency0: string,
  currency1: string,
  recipient: string,
): Action {
  return {
    code: ACTIONS.TAKE_PAIR,
    params: abi.encode(
      ["address", "address", "address"],
      [currency0, currency1, recipient],
    ),
  };
}

/**
 * Settle or take whatever this currency's net delta turns out to be.
 *
 * The action a compound plan needs. After a burn and a mint in one unlock, each
 * currency has a single net delta whose sign is not known when the calldata is
 * written: re-centring into a narrower range returns tokens, into a wider one
 * consumes them. SETTLE_PAIR assumes owing and TAKE_PAIR assumes owed; this
 * one reads the sign and does the right thing.
 */
export function closeCurrency(currency: string): Action {
  return {
    code: ACTIONS.CLOSE_CURRENCY,
    params: abi.encode(["address"], [currency]),
  };
}

/**
 * Pack a sequence into `modifyLiquidities` calldata.
 *
 * Every sequence has to end by closing its deltas, either settling what it owes
 * or taking what it is owed. A sequence that does not is not a smaller
 * operation, it is a reverting one.
 */
export function encodeModifyLiquidities(
  actions: Action[],
  deadline: bigint,
): string {
  if (actions.length === 0) throw new Error("no actions to encode");

  const codes =
    "0x" + actions.map((a) => a.code.toString(16).padStart(2, "0")).join("");
  const unlockData = abi.encode(
    ["bytes", "bytes[]"],
    [codes, actions.map((a) => a.params)],
  );
  const args = abi.encode(["bytes", "uint256"], [unlockData, deadline]);
  return MODIFY_LIQUIDITIES_SELECTOR + args.slice(2);
}

/* ------------------------------------------------------------- sequences */

/** Open a position and pay for it. */
export function planMint(args: {
  key: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: string;
  deadline: bigint;
}): string {
  return encodeModifyLiquidities(
    [mintPosition(args), settlePair(args.key.currency0, args.key.currency1)],
    args.deadline,
  );
}

/**
 * Collect fees without touching the position.
 *
 * A decrease of zero liquidity is how v4 spells "collect": the position is
 * unchanged and the fees it has accrued become a delta, which TAKE_PAIR then
 * pays out. There is no separate collect action.
 */
export function planCollect(args: {
  key: PoolKey;
  tokenId: bigint;
  recipient: string;
  deadline: bigint;
}): string {
  return encodeModifyLiquidities(
    [
      decreaseLiquidity({
        tokenId: args.tokenId,
        liquidity: 0n,
        // Fees are whatever they are; a minimum here would reject a quiet hour.
        amount0Min: 0n,
        amount1Min: 0n,
      }),
      takePair(args.key.currency0, args.key.currency1, args.recipient),
    ],
    args.deadline,
  );
}

/** Close a position entirely and take back principal and fees. */
export function planClose(args: {
  key: PoolKey;
  tokenId: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: string;
  deadline: bigint;
}): string {
  return encodeModifyLiquidities(
    [
      // BURN_POSITION decreases to zero first if the position is not empty, so
      // this is one action rather than a decrease followed by a burn.
      burnPosition({
        tokenId: args.tokenId,
        amount0Min: args.amount0Min,
        amount1Min: args.amount1Min,
      }),
      takePair(args.key.currency0, args.key.currency1, args.recipient),
    ],
    args.deadline,
  );
}

/**
 * Close a position and open a new one at the current price, atomically.
 *
 * One unlock rather than a close transaction followed by a mint transaction.
 * The difference is not gas: two transactions can half-succeed, leaving the
 * desk holding inventory with no position and a registry that believes it has
 * one. Here either both happen or neither does, and the tokens the burn
 * returns pay for the mint without a round trip through the vault.
 */
export function planRecentre(args: {
  key: PoolKey;
  tokenId: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: string;
  deadline: bigint;
}): string {
  return encodeModifyLiquidities(
    [
      burnPosition({
        tokenId: args.tokenId,
        amount0Min: args.amount0Min,
        amount1Min: args.amount1Min,
      }),
      mintPosition(args),
      // Each currency nets across both, and the sign depends on whether the new
      // range is wider or narrower than the old one.
      closeCurrency(args.key.currency0),
      closeCurrency(args.key.currency1),
    ],
    args.deadline,
  );
}
