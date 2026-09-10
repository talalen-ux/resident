/**
 * What the desk actually holds, read from the chain.
 *
 * The journal says which positions were opened. It cannot say what they are
 * worth now, or how much fee has accrued inside them since the last sweep, and
 * those two numbers drive five of the seven rules in decide.ts. Without them
 * the keeper ranks the board correctly and is blind to its own book.
 *
 * Every selector and every bit offset below was derived from
 * @uniswap/v4-periphery source rather than written from memory:
 *
 *   PositionInfo packs 200 bits poolId | 24 tickUpper | 24 tickLower |
 *   8 hasSubscriber, per PositionInfoLibrary.sol, with tickLower at offset 8
 *   and tickUpper at offset 32.
 *
 *   The pool-level position is keyed by keccak256(owner, tickLower, tickUpper,
 *   salt) where owner is the PositionManager and salt is bytes32(tokenId).
 *   PositionManager.sol passes bytes32(tokenId) as the salt on every
 *   _modifyLiquidity call.
 *
 * test/position-reader.test.mjs asserts the selectors still match those
 * signatures, so a rename upstream breaks the build rather than the desk.
 */

import { positionValue } from "../sim/band.ts";

/** StateView and PositionManager selectors. See the note above. */
export const POSITION_SELECTORS = {
  /** PositionManager.getPoolAndPositionInfo(uint256) */
  getPoolAndPositionInfo: "0x7ba03aad",
  /** PositionManager.getPositionLiquidity(uint256) */
  getPositionLiquidity: "0x1efeed33",
  /** StateView.getPositionInfo(bytes32 poolId, bytes32 positionId) */
  getPositionInfo: "0x97fd7b42",
  /** StateView.getFeeGrowthInside(bytes32 poolId, int24 lower, int24 upper) */
  getFeeGrowthInside: "0x53e9c1fb",
  /** IERC20.balanceOf(address) */
  balanceOf: "0x70a08231",
} as const;

const TICK_LOWER_OFFSET = 8n;
const TICK_UPPER_OFFSET = 32n;
const Q128 = 1n << 128n;

/** Read the nth 32-byte word of an eth_call result. */
export function word(hex: string, index: number): string {
  const start = 2 + index * 64;
  return hex.slice(start, start + 64);
}

/** A 24-bit two's-complement tick, as packed into PositionInfo. */
export function toInt24(value: bigint): number {
  const masked = value & 0xffffffn;
  return Number(masked >= 0x800000n ? masked - 0x1000000n : masked);
}

/**
 * Pull the bounds out of a packed PositionInfo word.
 *
 * The poolId in the upper 200 bits is deliberately ignored: it is truncated,
 * so it cannot be compared against a full PoolId, and the untruncated key comes
 * back from the same call anyway.
 */
export function unpackPositionInfo(info: bigint): {
  tickLower: number;
  tickUpper: number;
  hasSubscriber: boolean;
} {
  return {
    tickLower: toInt24(info >> TICK_LOWER_OFFSET),
    tickUpper: toInt24(info >> TICK_UPPER_OFFSET),
    hasSubscriber: (info & 0xffn) !== 0n,
  };
}

/**
 * Fee growth counters wrap, and the protocol relies on it.
 *
 * feeGrowthInside is a uint256 that is allowed to overflow: the difference
 * between two readings is correct modulo 2^256 even when the later reading is
 * numerically smaller. Subtracting these as ordinary integers produces an
 * enormous positive fee on the tick it wraps, which is the sort of number that
 * makes a desk book a windfall and sweep against it.
 */
export function feesOwed(
  growthNow: bigint,
  growthLast: bigint,
  liquidity: bigint,
): bigint {
  const delta = BigInt.asUintN(256, growthNow - growthLast);
  return (delta * liquidity) / Q128;
}

export type PositionRead = {
  tokenId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  /** Unswept fees, in raw token units. */
  fees0: bigint;
  fees1: bigint;
  /** The pool key as PositionManager reports it, for the caller to price. */
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

export type Call = (to: string, data: string) => Promise<string>;

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/**
 * Everything about one position that the chain knows and the journal does not.
 *
 * Three calls: the pool key and bounds from the PositionManager, the position's
 * own liquidity and last-seen fee growth from the pool, and the fee growth
 * inside the range right now. The difference between the last two is the fee
 * that has accrued since the position last touched.
 */
export async function readPosition(
  deps: {
    call: Call;
    positionManager: string;
    stateView: string;
    /** keccak256 over packed bytes. Injected so this stays free of ethers. */
    keccakPacked: (owner: string, lower: number, upper: number, salt: string) => string;
    poolIdOf: (key: {
      currency0: string;
      currency1: string;
      fee: number;
      tickSpacing: number;
      hooks: string;
    }) => string;
  },
  tokenId: string,
): Promise<PositionRead> {
  const idWord = pad(BigInt(tokenId).toString(16));

  const [poolAndInfo, liquidityHex] = await Promise.all([
    deps.call(deps.positionManager, POSITION_SELECTORS.getPoolAndPositionInfo + idWord),
    deps.call(deps.positionManager, POSITION_SELECTORS.getPositionLiquidity + idWord),
  ]);

  // (currency0, currency1, fee, tickSpacing, hooks, info)
  const key = {
    currency0: `0x${word(poolAndInfo, 0).slice(24)}`,
    currency1: `0x${word(poolAndInfo, 1).slice(24)}`,
    fee: Number(BigInt(`0x${word(poolAndInfo, 2)}`)),
    tickSpacing: toInt24(BigInt(`0x${word(poolAndInfo, 3)}`)),
    hooks: `0x${word(poolAndInfo, 4).slice(24)}`,
  };
  const { tickLower, tickUpper } = unpackPositionInfo(BigInt(`0x${word(poolAndInfo, 5)}`));
  const liquidity = BigInt(liquidityHex === "0x" ? "0x0" : liquidityHex);

  const poolId = deps.poolIdOf(key);
  const positionId = deps.keccakPacked(
    deps.positionManager,
    tickLower,
    tickUpper,
    `0x${idWord}`,
  );

  const [positionInfo, growthNow] = await Promise.all([
    deps.call(
      deps.stateView,
      POSITION_SELECTORS.getPositionInfo + pad(poolId) + pad(positionId),
    ),
    deps.call(
      deps.stateView,
      POSITION_SELECTORS.getFeeGrowthInside +
        pad(poolId) +
        pad(BigInt.asUintN(256, BigInt(tickLower)).toString(16)) +
        pad(BigInt.asUintN(256, BigInt(tickUpper)).toString(16)),
    ),
  ]);

  const last0 = BigInt(`0x${word(positionInfo, 1)}`);
  const last1 = BigInt(`0x${word(positionInfo, 2)}`);
  const now0 = BigInt(`0x${word(growthNow, 0)}`);
  const now1 = BigInt(`0x${word(growthNow, 1)}`);

  return {
    tokenId,
    tickLower,
    tickUpper,
    liquidity,
    fees0: feesOwed(now0, last0, liquidity),
    fees1: feesOwed(now1, last1, liquidity),
    ...key,
  };
}

/** Price at a tick, as token1 per token0, adjusted for decimals. */
export function priceAtTick(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

/**
 * Quote-unit value of a position, excluding its unswept fees.
 *
 * Kept apart from the fees deliberately, because decide.ts treats them as
 * different things: fees are income, and the change in this number is what the
 * price move cost.
 */
export function valueOf(
  position: PositionRead,
  price: number,
  decimals0: number,
  decimals1: number,
): number {
  if (position.liquidity === 0n) return 0;
  const pa = priceAtTick(position.tickLower, decimals0, decimals1);
  const pb = priceAtTick(position.tickUpper, decimals0, decimals1);
  // Liquidity is scaled by sqrt(10^d0 * 10^d1); undo it so the amounts come out
  // in whole tokens and the value in quote units.
  const scale = Math.sqrt(Math.pow(10, decimals0) * Math.pow(10, decimals1));
  return positionValue(Number(position.liquidity) / scale, pa, pb, price);
}
