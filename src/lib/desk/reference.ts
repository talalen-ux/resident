/**
 * What the token is worth somewhere that is not this pool.
 *
 * "Pool vs real price" is the field that catches a stale or pushed pool before
 * capital is placed into it. A pool quoting 12% away from everywhere else is
 * either about to be arbitraged — in which case the liquidity sitting in it is
 * what pays for that — or it is thin enough that one order moved it, which is
 * the same problem seen from the other end.
 *
 * The reference here is built from the other pools quoting the same base token,
 * weighted by their volume. That is deliberate: it needs no oracle, no external
 * feed and no new trust assumption, because it comes out of exactly the logs
 * already being read to price the board. It is weaker than a real oracle and
 * the weakness is specific — if every pool on a token is stale, so is this —
 * so the deviation is reported alongside how many pools and how much volume
 * stand behind it, and a reference built from one thin pool says so.
 */

export type Quote = {
  /** Pool identifier, so a pool is never used as its own reference. */
  address: string;
  /** Base token, lowercased. Only pools on the same base are comparable. */
  base: string;
  /** Quote asset, lowercased. So is the quote: USDG and SOL are not the same. */
  quote: string;
  price: number;
  /** Trailing 24h volume in quote units, used as the weight. */
  volume24h: number;
};

export type Reference = {
  /** Volume-weighted price across every other pool on the same pair. */
  price: number;
  /** How many pools stand behind it. One is a warning, not a reference. */
  sources: number;
  /** Total volume behind it, in quote units. */
  volume: number;
};

/**
 * The reference price for one pool, from its peers.
 *
 * Returns null when there are no peers. Null is the honest answer and the
 * callers treat it as one: a pool that is the only market in its pair has no
 * off-pool price, and inventing one from its own quote would make the deviation
 * field read zero exactly where it is least informative.
 */
export function referenceFor(pool: Quote, peers: Quote[]): Reference | null {
  const usable = peers.filter(
    (p) =>
      p.address !== pool.address &&
      p.base === pool.base &&
      p.quote === pool.quote &&
      p.price > 0 &&
      p.volume24h > 0,
  );
  if (usable.length === 0) return null;

  const volume = usable.reduce((total, p) => total + p.volume24h, 0);
  const price =
    usable.reduce((total, p) => total + p.price * p.volume24h, 0) / volume;

  return { price, sources: usable.length, volume };
}

export type Deviation = {
  /** Fraction: 0.042 means the pool is quoting 4.2% above the reference. */
  deviation: number;
  reference: Reference;
  /** True when the gap is wide enough to hold off on. */
  stale: boolean;
};

/**
 * How far this pool has drifted from everywhere else.
 *
 * `tolerance` is the fraction beyond which the pool is treated as stale. It is
 * not a trading signal — a desk that chases the gap is arbitraging, which is a
 * different business with different risks. Here it is only ever a reason to
 * wait.
 */
export function deviationFrom(
  poolPrice: number,
  reference: Reference | null,
  tolerance = 0.03,
): Deviation | null {
  if (!reference || !(reference.price > 0) || !(poolPrice > 0)) return null;
  const deviation = poolPrice / reference.price - 1;
  return {
    deviation,
    reference,
    stale: Math.abs(deviation) > tolerance,
  };
}
