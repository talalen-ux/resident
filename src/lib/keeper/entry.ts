/**
 * Getting into a two-sided range from a treasury that holds only quote.
 *
 * A concentrated range that straddles the current price is funded with BOTH
 * tokens. The vault holds USDG and nothing else, so the liquidity a fresh desk
 * can mint into any band centred on spot is exactly zero — `liquidityForAmounts`
 * takes the smaller of the two sides, and one side is empty. Nothing reverts on
 * chain, because nothing is ever sent: the executor refuses the mint and every
 * open the desk decides on fails the same way.
 *
 * So an entry is two moves, not one. Buy the stock side, then mint. This file
 * is the first move: how much to buy.
 *
 * The arithmetic, in the pool's own raw units so no decimal conversion enters:
 *
 *   at liquidity L, in range,   amount0 = L·(1/√P − 1/√b)
 *                               amount1 = L·(√P − √a)
 *
 * Both are linear in L, so the ratio between them is fixed by the range and the
 * price alone. Price a unit of liquidity in quote, divide the capital by it,
 * and the amounts follow. No search, no iteration, and the same primitives the
 * mint is sized with — a split derived from different maths than the mint is a
 * split that leaves a remainder for a reason nobody can find.
 *
 * Two things this deliberately does not do.
 *
 * It does not assume half. "Swap 50% and LP" is right only for a range
 * symmetric in √P around spot, which a band in tick space is not. On a narrow
 * band the error is small; on the wide ones the desk uses when volatility is
 * high it is not, and the leftover sits in the vault earning nothing.
 *
 * It does not price the swap's own impact. Buying the stock moves the price it
 * is bought at, which changes the split that was just computed. Rather than
 * model that, the executor re-reads the pool after the swap and re-sizes
 * against what it finds. A measurement after the fact beats an estimate before
 * it, and the swap's slippage bound is what protects the trade meanwhile.
 */

import {
  amount0Delta,
  amount1Delta,
  sqrtPriceAtTick,
} from "../sim/v3.ts";

const Q96 = 2n ** 96n;

/**
 * A reference liquidity to take the ratio at.
 *
 * Large enough that the two amounts keep full precision through the integer
 * division, small enough to stay far from anything a pool would hold. The
 * value cancels out of the result.
 */
const REFERENCE_LIQUIDITY = 2n ** 96n;

export type EntrySplit = {
  /** Raw units of quote to sell for the stock token. */
  sell: bigint;
  /** Raw units of quote the mint will keep. */
  keep: bigint;
  /** Raw units of the stock token the mint needs. */
  stockNeeded: bigint;
};

/**
 * How to divide `quoteAmount` between buying the stock and funding the mint.
 *
 * Returns `sell: 0n` for a range that sits entirely on the quote side of spot,
 * which is the ladder case and needs no stock at all. A range entirely on the
 * stock side is the mirror: everything is sold.
 */
export function splitForRange(args: {
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  /**
   * True when the pool's token1 is the stock, so token0 is the quote.
   *
   * Optional because PoolState leaves it so: Uniswap orders a pool's tokens by
   * address, and absent means the stock landed on token0. Treating undefined
   * as anything else would read half the live pools upside down.
   */
  stockIsToken1?: boolean;
  /** Raw units of quote to commit. */
  quoteAmount: bigint;
}): EntrySplit {
  const { sqrtPriceX96: sqrtP, quoteAmount, stockIsToken1 } = args;
  let sqrtA = sqrtPriceAtTick(args.tickLower);
  let sqrtB = sqrtPriceAtTick(args.tickUpper);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];

  if (quoteAmount <= 0n || sqrtB <= sqrtA) {
    return { sell: 0n, keep: quoteAmount > 0n ? quoteAmount : 0n, stockNeeded: 0n };
  }

  // The two amounts one reference unit of liquidity would take, clamped the
  // same way the mint clamps them: outside the range, one side is unused.
  const clamped = sqrtP < sqrtA ? sqrtA : sqrtP > sqrtB ? sqrtB : sqrtP;
  const a0 = amount0Delta(clamped, sqrtB, REFERENCE_LIQUIDITY);
  const a1 = amount1Delta(sqrtA, clamped, REFERENCE_LIQUIDITY);

  const stockUnit = stockIsToken1 ? a1 : a0;
  const quoteUnit = stockIsToken1 ? a0 : a1;

  // Nothing to buy: the range wants only the asset we already hold.
  if (stockUnit === 0n) {
    return { sell: 0n, keep: quoteAmount, stockNeeded: 0n };
  }

  // What that unit of liquidity costs, all of it in quote.
  //
  // P is token1 per token0, as sqrtPriceX96² / 2¹⁹². Multiplying before
  // dividing keeps the whole thing in integers; at the reference liquidity
  // both terms are far larger than the divisor.
  const stockInQuote = stockIsToken1
    ? (stockUnit * Q96 * Q96) / (sqrtP * sqrtP) // token1 → token0
    : (stockUnit * sqrtP * sqrtP) / (Q96 * Q96); // token0 → token1
  const unitCost = stockInQuote + quoteUnit;

  // Everything goes to the stock side: the range is entirely past spot.
  if (quoteUnit === 0n) {
    return { sell: quoteAmount, keep: 0n, stockNeeded: (REFERENCE_LIQUIDITY * quoteAmount) / unitCost * stockUnit / REFERENCE_LIQUIDITY };
  }

  const sell = (quoteAmount * stockInQuote) / unitCost;
  const liquidity = (REFERENCE_LIQUIDITY * quoteAmount) / unitCost;
  return {
    sell,
    keep: quoteAmount - sell,
    stockNeeded: (liquidity * stockUnit) / REFERENCE_LIQUIDITY,
  };
}

/**
 * What still has to be bought, given what the vault already holds.
 *
 * Fees arrive as the token, so a desk that has been running is rarely starting
 * from zero. Buying the whole side when part of it is already in the vault
 * pays the spread on tokens we own, and leaves the surplus as inventory the
 * ladder then has to work off.
 *
 * The buffer covers the rounding between this sizing and the mint's own, which
 * re-derives the amounts after the swap has moved the price. Being a few raw
 * units short turns a successful entry into a smaller position than intended;
 * being a few over leaves dust.
 */
export function shortfall(
  stockNeeded: bigint,
  stockHeld: bigint,
  bufferBps = 50,
): bigint {
  const target = stockNeeded + (stockNeeded * BigInt(bufferBps)) / 10_000n;
  const missing = target - stockHeld;
  return missing > 0n ? missing : 0n;
}

/**
 * The quote the pool can absorb before the entry buy runs out of range.
 *
 * The bound on an entry buy. Buying the stock side happens in the pool the
 * desk is about to provide liquidity to, so the order walks the price it is
 * about to mint at — a thin pool can be pushed a long way by an order that
 * looked reasonable against volume.
 *
 * Measured on the side the trade pushes into, not across the whole band. A buy
 * consumes the stock above spot and pays quote in; the quote sitting below
 * spot is not depth this order can reach, and counting it would permit an
 * order twice the size the pool can take.
 *
 *   quote is token1  →  buying token0 raises the price, so spot → upper edge
 *   quote is token0  →  buying token1 lowers it, so lower edge → spot
 *
 * Active liquidity is treated as constant across the range, which is what the
 * pool reports and what it is exactly within the current tick range. Beyond it
 * the figure is an approximation, and that is the reason this is a share
 * rather than a limit: at 20% of a depth that is itself approximate, being
 * wrong by a quarter still leaves the order inside the band.
 */
export function bandQuoteDepth(
  state: {
    liquidity: bigint;
    sqrtPriceX96: bigint;
    stockIsToken1?: boolean;
  },
  tickLower: number,
  tickUpper: number,
): bigint {
  let sqrtA = sqrtPriceAtTick(tickLower);
  let sqrtB = sqrtPriceAtTick(tickUpper);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtB <= sqrtA || state.liquidity <= 0n) return 0n;

  const sqrtP = state.sqrtPriceX96;
  const clamped = sqrtP < sqrtA ? sqrtA : sqrtP > sqrtB ? sqrtB : sqrtP;

  return state.stockIsToken1
    ? amount0Delta(sqrtA, clamped, state.liquidity)
    : amount1Delta(clamped, sqrtB, state.liquidity);
}
