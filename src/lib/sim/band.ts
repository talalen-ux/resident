/**
 * Concentrated-liquidity position value and divergence loss.
 *
 * The opportunity board estimates band income as volume × fee × share and stops
 * there. Real positions do not: a two-sided band is continuously selling the
 * winner and buying the loser, and that bleed is what turns a large fee number
 * into a small net one. Operator data from a comparable desk showed three of
 * four positions underwater on principal while still net positive after fees —
 * so income alone ranks pools wrong.
 *
 * Everything here is exact Uniswap v3 position algebra rather than the v2
 * impermanent-loss approximation, which understates the bleed badly for a tight
 * range.
 */

/** Token amounts held by a position of liquidity L in [pa, pb] at price p. */
export function positionAmounts(
  liquidity: number,
  pa: number,
  pb: number,
  p: number,
): { amount0: number; amount1: number } {
  const sa = Math.sqrt(pa);
  const sb = Math.sqrt(pb);
  const s = Math.sqrt(Math.min(Math.max(p, pa), pb));

  // Below the range the position is entirely token0; above it, entirely token1.
  return {
    amount0: liquidity * (1 / s - 1 / sb),
    amount1: liquidity * (s - sa),
  };
}

/** Position value in quote units at price p. */
export function positionValue(
  liquidity: number,
  pa: number,
  pb: number,
  p: number,
): number {
  const { amount0, amount1 } = positionAmounts(liquidity, pa, pb, p);
  return amount0 * p + amount1;
}

/**
 * Liquidity for a band funded with `capital` quote units at price p0.
 *
 * From C = L·(2√p0 − p0/√pb − √pa), the value identity at the price the
 * position is opened at.
 */
export function liquidityForCapital(
  capital: number,
  pa: number,
  pb: number,
  p0: number,
): number {
  const denominator = 2 * Math.sqrt(p0) - p0 / Math.sqrt(pb) - Math.sqrt(pa);
  if (denominator <= 0) return 0;
  return capital / denominator;
}

/**
 * Liquidity for a range funded with the base token alone.
 *
 * The counterpart to {@link liquidityForCapital}, which assumes the price sits
 * inside the range and takes quote capital. A range entirely above the price
 * holds no quote at all, and putting it through the two-sided formula returns
 * zero: the denominator goes negative the moment `pa` rises above `p0`.
 *
 * Same L as everywhere else, derived from the other side of the curve —
 * amount0 = L(1/√pa − 1/√pb) — so it compares directly against a pool's
 * liquidity for a share calculation.
 */
export function liquidityForBase(
  quantity: number,
  pa: number,
  pb: number,
): number {
  if (!(quantity > 0) || !(pa > 0) || !(pb > pa)) return 0;
  const denominator = 1 / Math.sqrt(pa) - 1 / Math.sqrt(pb);
  return denominator > 0 ? quantity / denominator : 0;
}

export type Band = {
  /** Lower bound, quote per token0. */
  lower: number;
  /** Upper bound. */
  upper: number;
  /** Price the band was opened at. */
  openedAt: number;
  /** Quote units committed. */
  capital: number;
  liquidity: number;
};

/** A two-sided band of ±halfWidth around `price`, funded with `capital`. */
export function openBand(price: number, halfWidth: number, capital: number): Band {
  const lower = price * (1 - halfWidth);
  const upper = price * (1 + halfWidth);
  return {
    lower,
    upper,
    openedAt: price,
    capital,
    liquidity: liquidityForCapital(capital, lower, upper, price),
  };
}

/**
 * Divergence loss at price p: what the position is worth, less what the same
 * tokens would have been worth had they simply been held.
 *
 * Returned as a fraction of the capital committed. Always ≤ 0.
 */
export function divergenceLoss(band: Band, p: number): number {
  const held = positionAmounts(band.liquidity, band.lower, band.upper, band.openedAt);
  const hodl = held.amount0 * p + held.amount1;
  const now = positionValue(band.liquidity, band.lower, band.upper, p);
  return (now - hodl) / band.capital;
}

/** Whether the price is inside the band, so the position is still earning. */
export const inRange = (band: Band, p: number) => p >= band.lower && p <= band.upper;

/**
 * The price move, up and down, at which accumulated fees stop covering
 * divergence loss.
 *
 * This is the number that decides whether a band is worth opening: a pool
 * paying 3% a day in fees against a book that routinely moves 20% is a losing
 * position however large the fee figure looks.
 */
export function breakevenMove(
  band: Band,
  feeIncome: number,
  maxMove = 0.9,
): { up: number | null; down: number | null } {
  const feeFraction = feeIncome / band.capital;

  const search = (direction: 1 | -1): number | null => {
    let lo = 0;
    let hi = maxMove;
    // Loss is monotonic in |move|, so bisect.
    if (-divergenceLoss(band, band.openedAt * (1 + direction * hi)) <= feeFraction) {
      return null; // fees cover the worst move considered
    }
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const loss = -divergenceLoss(band, band.openedAt * (1 + direction * mid));
      if (loss <= feeFraction) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  return { up: search(1), down: search(-1) };
}
