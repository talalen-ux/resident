/**
 * Selling harvested inventory back to the quote asset.
 *
 * The desk deploys USDG and gets paid in whatever the pool charges fees in, so
 * without this the treasury slowly becomes a pile of the tokens it has been
 * making markets in. That is not just untidy accounting: those tokens carry
 * full price risk, earn nothing while they sit there, and cannot be redeployed
 * into the next position.
 *
 * WHY THIS IS NOT THE FIRST THING TRIED
 *
 * Market-selling every harvest is a worse strategy than it looks. Fees arrive
 * in the token precisely when that token is trading, and dumping into the flow
 * you just earned from pays the spread twice. The ladder rule gets first
 * refusal for exactly that reason — resting inventory above the price sells it
 * to someone who wants it, at a price we choose.
 *
 * So this is the fallback, not the default: inventory the ladder has not
 * cleared after a while gets converted, because a treasury holding a position
 * it decided against is worse than a treasury paying the spread once.
 *
 * ENCODING
 *
 * Every constant below was read from source, not memory:
 *   V4_SWAP = 0x10                       universal-router Commands.sol
 *   SWAP_EXACT_IN_SINGLE = 0x06          v4-periphery Actions.sol
 *   SETTLE_ALL = 0x0c, TAKE_ALL = 0x0f   same
 *   execute(bytes,bytes[],uint256)       UniversalRouter.sol
 *   ExactInputSingleParams               IV4Router.sol
 * test/swap-v4.test.mjs re-derives the selector and asserts the layout.
 */

import { AbiCoder, Interface } from "ethers";

import { UNISWAP } from "../chain.ts";
import type { PoolKey } from "../sim/v4.ts";
import type { UnsignedCall } from "./signer.ts";

const abi = AbiCoder.defaultAbiCoder();

const ROUTER = new Interface([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

/** universal-router Commands.sol */
export const V4_SWAP = 0x10;

/** v4-periphery Actions.sol */
export const SWAP_ACTIONS = {
  swapExactInSingle: 0x06,
  settleAll: 0x0c,
  takeAll: 0x0f,
} as const;

const POOL_KEY = "(address,address,uint24,int24,address)";
const EXACT_IN_SINGLE = `(${POOL_KEY},bool,uint128,uint128,bytes)`;

export type SwapPlan = {
  key: PoolKey;
  /** True when selling currency0 for currency1. */
  zeroForOne: boolean;
  /** Raw units of the token being sold. */
  amountIn: bigint;
  /** Raw units of quote below which the swap must revert. Never zero. */
  minOut: bigint;
  deadline: number;
};

export class NoSlippageBound extends Error {
  constructor() {
    super(
      "a swap needs a real minimum out. Zero means any price is acceptable, " +
        "which on a thin pool is the whole position for nothing.",
    );
    this.name = "NoSlippageBound";
  }
}

/**
 * One exact-input swap, as the UniversalRouter wants it.
 *
 * Three actions rather than one: the swap computes the deltas, SETTLE_ALL pays
 * what is owed, TAKE_ALL collects what is due. The bound goes on TAKE_ALL as
 * well as on the swap because they check different things — the swap's minimum
 * is on its own output, TAKE_ALL's is on the whole credit, and a route that
 * silently paid out less would pass the first and fail the second.
 */
export function swapCall(plan: SwapPlan): UnsignedCall {
  if (!(plan.minOut > 0n)) throw new NoSlippageBound();
  if (!(plan.amountIn > 0n)) {
    throw new Error("swap: amountIn is zero, so there is nothing to sell");
  }

  const key = [
    plan.key.currency0,
    plan.key.currency1,
    plan.key.fee,
    plan.key.tickSpacing,
    plan.key.hooks,
  ];
  const sold = plan.zeroForOne ? plan.key.currency0 : plan.key.currency1;
  const bought = plan.zeroForOne ? plan.key.currency1 : plan.key.currency0;

  const actions =
    "0x" +
    [
      SWAP_ACTIONS.swapExactInSingle,
      SWAP_ACTIONS.settleAll,
      SWAP_ACTIONS.takeAll,
    ]
      .map((a) => a.toString(16).padStart(2, "0"))
      .join("");

  const params = [
    abi.encode(
      [EXACT_IN_SINGLE],
      [[key, plan.zeroForOne, plan.amountIn, plan.minOut, "0x"]],
    ),
    abi.encode(["address", "uint256"], [sold, plan.amountIn]),
    abi.encode(["address", "uint256"], [bought, plan.minOut]),
  ];

  const input = abi.encode(["bytes", "bytes[]"], [actions, params]);
  const commands = "0x" + V4_SWAP.toString(16).padStart(2, "0");

  return {
    to: UNISWAP.universalRouter,
    data: ROUTER.encodeFunctionData("execute", [commands, [input], plan.deadline]),
    description: `sell ${plan.amountIn} of ${sold.slice(0, 10)} for at least ${plan.minOut}`,
  };
}

export type ConvertConfig = {
  /**
   * Intervals inventory may sit unconverted before it is sold at market.
   *
   * The ladder gets first refusal. This is how long it gets: long enough that
   * a token worth resting above the price is rested, short enough that the
   * treasury does not quietly become a portfolio of things it decided against.
   */
  patience: number;
  /** Most of the pool's in-band liquidity one swap may consume. */
  maxImpact: number;
  /** Slippage allowed against the quoted price, as a fraction. */
  slippage: number;
  /** Do not bother below this, in quote units: the gas costs more. */
  minValue: number;
};

export const DEFAULT_CONVERT: ConvertConfig = {
  // Two hours of minutes. A ladder that has not filled in that long is not
  // going to be filled by waiting quietly.
  patience: 120,
  // A swap that eats a fifth of the depth within 5% of spot moves the price
  // against itself more than the inventory is worth avoiding.
  maxImpact: 0.2,
  slippage: 0.01,
  minValue: 25,
};

export type ConvertVerdict = {
  convert: boolean;
  /** Raw units to sell, which may be less than what is held. */
  amountIn: number;
  reason: string;
};

/**
 * Should this inventory be sold, and how much of it?
 *
 * Size is capped by what the pool can absorb rather than by what is held. A
 * position the desk could not exit in one trade is one it sells in several, and
 * the alternative — taking the whole line out at any price — is how a harvest
 * turns into a loss larger than the fees that produced it.
 */
export function shouldConvert(
  inventory: { quantity: number; price: number; heldIntervals: number },
  poolLiquidity: number,
  config: ConvertConfig = DEFAULT_CONVERT,
): ConvertVerdict {
  const value = inventory.quantity * inventory.price;

  if (!(value > 0)) {
    return { convert: false, amountIn: 0, reason: "nothing held" };
  }
  if (value < config.minValue) {
    return {
      convert: false,
      amountIn: 0,
      reason: `${value.toFixed(2)} is under the ${config.minValue} floor; the gas costs more`,
    };
  }
  if (inventory.heldIntervals < config.patience) {
    return {
      convert: false,
      amountIn: 0,
      reason:
        `held ${inventory.heldIntervals} of ${config.patience} intervals. ` +
        "The ladder has first refusal, and selling into the flow we just earned " +
        "from pays the spread twice",
    };
  }

  const ceiling = poolLiquidity * config.maxImpact;
  const sellable = Math.min(value, ceiling) / inventory.price;

  if (!(sellable > 0)) {
    return {
      convert: false,
      amountIn: 0,
      reason: "the pool has no depth to sell into",
    };
  }

  return {
    convert: true,
    amountIn: sellable,
    reason:
      sellable < inventory.quantity
        ? `selling ${sellable.toFixed(4)} of ${inventory.quantity.toFixed(4)}: more would take over ` +
          `${(config.maxImpact * 100).toFixed(0)}% of the depth`
        : `held ${inventory.heldIntervals} intervals, the ladder did not clear it`,
  };
}

/** The floor a swap must clear, from the price it was quoted at. */
export function minOutFor(
  amountIn: number,
  price: number,
  decimals: number,
  config: ConvertConfig = DEFAULT_CONVERT,
): bigint {
  const expected = amountIn * price * (1 - config.slippage);
  return BigInt(Math.floor(expected * Math.pow(10, decimals)));
}
