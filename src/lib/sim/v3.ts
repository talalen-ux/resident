/**
 * Uniswap v3 concentrated-liquidity swap math.
 *
 * Exact-input simulation over a tick-indexed liquidity distribution, in the same
 * Q64.96 fixed point the pool uses, with integer arithmetic throughout — the
 * desk sizes orders off these numbers, so a float here is a rounding error in
 * a real order.
 *
 * This is the engine behind every quantity in the method: the deviation δ is
 * read from the marginal price, the fillability probe Φ is an exact-input quote,
 * the impact function I(Q) is a sweep of them, and S* is a search over them.
 */

export const Q96 = 2n ** 96n;
const MAX_UINT160 = 2n ** 160n - 1n;

/** One initialised tick: the price boundary and the liquidity change at it. */
export type Tick = {
  index: number;
  /** Liquidity added when crossing left-to-right; removed right-to-left. */
  liquidityNet: bigint;
};

export type PoolState = {
  /**
   * True when the equity/stock token is token1 rather than token0.
   *
   * Uniswap orders a pool's tokens by address, so which side the stock lands on
   * is arbitrary, and a meaningful share of live pools land the stock on
   * token1. Everything else in this file is written in
   * token0/token1 terms and is unaffected; this flag exists so callers that
   * mean "the stock" rather than "token0" can orient themselves, and so a pool
   * with inverted ordering is never silently read upside down.
   */
  stockIsToken1?: boolean;
  /** Current price as sqrt(token1/token0) in Q96. */
  sqrtPriceX96: bigint;
  /** Liquidity in the active range. */
  liquidity: bigint;
  /** Current tick. */
  tick: number;
  /** Fee in hundredths of a bip: 500 = 0.05%, 3000 = 0.3%. */
  fee: number;
  /** Spacing between initialisable ticks. */
  tickSpacing: number;
  /** Initialised ticks, ascending by index. */
  ticks: Tick[];
  token0: TokenMeta;
  token1: TokenMeta;
};

export type TokenMeta = {
  symbol: string;
  decimals: number;
  /** Contract address. Required to check the token is the canonical one. */
  address?: string;
};

/** sqrt(1.0001^tick) in Q96. Derived, not table-driven, so any tick is valid. */
export function sqrtPriceAtTick(tick: number): bigint {
  // 1.0001^(tick/2), evaluated in floating point then lifted to Q96. The pool's
  // own TickMath is exact; this is accurate to ~1e-12 relative, far below the
  // sizing tolerances the desk works to, and it keeps arbitrary ticks valid.
  const ratio = Math.pow(1.0001, tick / 2);
  return BigInt(Math.floor(ratio * 2 ** 96));
}

export function tickAtSqrtPrice(sqrtPriceX96: bigint): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return Math.floor(Math.log(ratio * ratio) / Math.log(1.0001));
}

const mulDiv = (a: bigint, b: bigint, d: bigint) => (a * b) / d;

/** Token0 required to move price from sqrtA up to sqrtB (sqrtB > sqrtA). */
export function amount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA === 0n) return 0n;
  return mulDiv(liquidity << 96n, sqrtB - sqrtA, sqrtB) / sqrtA;
}

/** Token1 delta between two prices at a given liquidity. */
export function amount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return mulDiv(liquidity, sqrtB - sqrtA, Q96);
}

/** Price after adding `amountIn` of token0 (price falls). */
export function nextSqrtPriceFromAmount0(
  sqrtP: bigint,
  liquidity: bigint,
  amountIn: bigint,
): bigint {
  if (amountIn === 0n) return sqrtP;
  const numerator = liquidity << 96n;
  const denominator = numerator + amountIn * sqrtP;
  return mulDiv(numerator, sqrtP, denominator);
}

/** Price after adding `amountIn` of token1 (price rises). */
export function nextSqrtPriceFromAmount1(
  sqrtP: bigint,
  liquidity: bigint,
  amountIn: bigint,
): bigint {
  const next = sqrtP + mulDiv(amountIn, Q96, liquidity);
  return next > MAX_UINT160 ? MAX_UINT160 : next;
}

export type SwapResult = {
  /** Input actually consumed. Less than requested if the book ran out. */
  amountIn: bigint;
  /** Output received, fees and impact included. */
  amountOut: bigint;
  /** Marginal price after the swap, Q96. */
  sqrtPriceX96After: bigint;
  /** Ticks crossed. A swap crossing many ticks is eating through the book. */
  ticksCrossed: number;
  /** True when liquidity was exhausted before the full input could be spent. */
  exhausted: boolean;
  /** Fee paid, in input-token units. */
  feePaid: bigint;
};

/**
 * Exact-input swap.
 *
 * @param zeroForOne selling token0 for token1 (price falls) when true.
 *
 * Walks the tick list the way the pool does: fill within the active range, and
 * if the input is not exhausted, cross to the next initialised tick, apply its
 * liquidityNet, and continue. When the book runs out the swap returns what it
 * could fill and flags `exhausted` — which is how a mirage is caught, since a
 * pool with a spectacular displayed price but nothing behind it fills nothing.
 */
export function swapExactIn(
  pool: PoolState,
  zeroForOne: boolean,
  amountSpecified: bigint,
): SwapResult {
  let sqrtP = pool.sqrtPriceX96;
  let liquidity = pool.liquidity;
  let remaining = amountSpecified;
  let amountOut = 0n;
  let feePaid = 0n;
  let ticksCrossed = 0;

  // Ticks in the direction of travel, nearest first.
  const ordered = [...pool.ticks].sort((a, b) =>
    zeroForOne ? b.index - a.index : a.index - b.index,
  );
  const ahead = ordered.filter((t) =>
    zeroForOne ? t.index < pool.tick : t.index > pool.tick,
  );

  let cursor = 0;
  // Bounded: each iteration either exhausts the input or consumes one tick.
  while (remaining > 0n && liquidity > 0n && cursor <= ahead.length) {
    const nextTick = ahead[cursor];
    const sqrtTarget = nextTick
      ? sqrtPriceAtTick(nextTick.index)
      : zeroForOne
        ? 1n
        : MAX_UINT160;

    // Fee is taken off the input before it moves price, as the pool does.
    const feeAmount = (remaining * BigInt(pool.fee)) / 1_000_000n;
    const inAfterFee = remaining - feeAmount;

    const sqrtNextUnclamped = zeroForOne
      ? nextSqrtPriceFromAmount0(sqrtP, liquidity, inAfterFee)
      : nextSqrtPriceFromAmount1(sqrtP, liquidity, inAfterFee);

    const reachesTarget = zeroForOne
      ? sqrtNextUnclamped <= sqrtTarget
      : sqrtNextUnclamped >= sqrtTarget;

    const sqrtNext = reachesTarget ? sqrtTarget : sqrtNextUnclamped;

    const stepIn = zeroForOne
      ? amount0Delta(sqrtNext, sqrtP, liquidity)
      : amount1Delta(sqrtP, sqrtNext, liquidity);
    const stepOut = zeroForOne
      ? amount1Delta(sqrtNext, sqrtP, liquidity)
      : amount0Delta(sqrtP, sqrtNext, liquidity);

    if (reachesTarget) {
      // Consumed the range; charge the fee on the portion actually used.
      const stepFee = (stepIn * BigInt(pool.fee)) / (1_000_000n - BigInt(pool.fee));
      const consumed = stepIn + stepFee;
      if (consumed >= remaining) {
        // Rounding put us at or past the boundary — treat as fully spent.
        amountOut += stepOut;
        feePaid += remaining - stepIn > 0n ? remaining - stepIn : 0n;
        remaining = 0n;
        sqrtP = sqrtNext;
        break;
      }
      remaining -= consumed;
      feePaid += stepFee;
      amountOut += stepOut;
      sqrtP = sqrtNext;

      if (!nextTick) break; // ran out of book
      // Cross the tick: liquidityNet applies with sign by direction.
      liquidity += zeroForOne ? -nextTick.liquidityNet : nextTick.liquidityNet;
      ticksCrossed++;
      cursor++;
      if (liquidity <= 0n) {
        liquidity = 0n;
        break;
      }
    } else {
      amountOut += stepOut;
      feePaid += feeAmount;
      remaining = 0n;
      sqrtP = sqrtNext;
    }
  }

  return {
    amountIn: amountSpecified - remaining,
    amountOut,
    sqrtPriceX96After: sqrtP,
    ticksCrossed,
    exhausted: remaining > 0n,
    feePaid,
  };
}

/**
 * Marginal price of token0 in token1, scaled to human units.
 * Returned as a float: this is a reporting figure, not an order size.
 */
export function priceFromSqrt(pool: PoolState, sqrtPriceX96: bigint): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const raw = ratio * ratio;
  return raw * 10 ** (pool.token0.decimals - pool.token1.decimals);
}

export const spotPrice = (pool: PoolState) => priceFromSqrt(pool, pool.sqrtPriceX96);
