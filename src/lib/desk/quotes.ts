/**
 * The assets a pool can be quoted in, and what one unit of them is worth.
 *
 * WHY THIS HAS TO EXIST THE MOMENT THERE IS A SECOND QUOTE
 *
 * Every threshold the desk publishes is a dollar figure: $25,000 of volume in
 * the trailing hour, no more than $400,000 of liquidity near the price, a
 * $10,000 position used to rank the board. A pool reports its volume and its
 * liquidity in whatever it is quoted in. While that was USDG alone the two were
 * the same number and nothing had to convert.
 *
 * With WETH in the set they are not. A WETH-quoted pool that has traded 8 WETH
 * in the last hour has traded roughly $25,000, and measuring 8 against a
 * threshold of 25,000 rejects it; measuring its 130 WETH of depth against a cap
 * of 400,000 waves through a pool with $400,000 in it several times over. Both
 * failures are silent, and the second one loses money.
 *
 * So the rule is: the desk's numbers are dollars, always, and the conversion
 * happens once at the point a pool is measured.
 *
 * WHERE THE RATE COMES FROM
 *
 * From a pool, not an oracle. The same chain quotes WETH against USDG, and that
 * market's own spot price is the rate. It adds no dependency and no new trust
 * assumption, because it is the same class of number the desk already reads to
 * price everything else. What it cannot do is survive that market being absent
 * or stale, which is why an unknown rate is null rather than a guess: a pool
 * that cannot be priced in dollars is one the board holds rather than measures
 * in the wrong unit.
 */

import { TOKENS } from "../chain.ts";

export type QuoteAsset = {
  symbol: string;
  address: string;
  decimals: number;
  /**
   * True when one unit is a dollar by construction.
   *
   * A stable quote needs no rate and cannot go stale, so it is worth
   * distinguishing rather than looking up a rate of 1.
   */
  stable: boolean;
};

export const QUOTE_ASSETS: readonly QuoteAsset[] = [
  { symbol: "USDG", address: TOKENS.usdg, decimals: 6, stable: true },
  { symbol: "WETH", address: TOKENS.weth, decimals: 18, stable: false },
] as const;

const BY_ADDRESS = new Map(
  QUOTE_ASSETS.map((q) => [q.address.toLowerCase(), q]),
);
const BY_SYMBOL = new Map(QUOTE_ASSETS.map((q) => [q.symbol, q]));

/** The quote asset at this address, or null if it is not one. */
export function quoteAssetAt(address: string): QuoteAsset | null {
  return BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

export const isQuoteAsset = (address: string) => quoteAssetAt(address) !== null;

/** USD per whole unit, keyed by symbol. Stable quotes need no entry. */
export type UsdRates = Record<string, number>;

/**
 * Dollars per whole unit of this quote asset, or null when it is not known.
 *
 * Null is the answer for an unknown symbol and for a non-stable quote with no
 * rate. Returning 1 in either case would price a WETH pool as though ether
 * traded at a dollar, which is not a small error in the safe direction: it
 * makes a deep pool look shallow and a shallow one look like nothing at all.
 */
export function usdPerQuote(symbol: string, rates: UsdRates): number | null {
  const asset = BY_SYMBOL.get(symbol);
  if (!asset) return null;
  if (asset.stable) return 1;
  const rate = rates[symbol];
  return typeof rate === "number" && rate > 0 ? rate : null;
}

/** One market's spot price, as the rate derivation sees it. */
export type QuotedMarket = {
  /** Symbol of the base token, e.g. "WETH". */
  base: string;
  /** Symbol of the quote token, e.g. "USDG". */
  quote: string;
  /** Quote units per whole base token. */
  price: number;
  /** Trailing 24h volume in quote units, used to pick between markets. */
  volume24h: number;
};

/**
 * Rates for every non-stable quote asset, read off the chain's own markets.
 *
 * A quote asset is priced by its market against a stable quote. Where more than
 * one such market exists the busiest wins rather than the first or an average:
 * an average lets a dead pool with a stale price drag the rate, and this number
 * scales every threshold the desk applies.
 */
export function deriveRates(markets: QuotedMarket[]): UsdRates {
  const best = new Map<string, QuotedMarket>();

  for (const market of markets) {
    const base = BY_SYMBOL.get(market.base);
    const quote = BY_SYMBOL.get(market.quote);
    if (!base || base.stable) continue;
    if (!quote || !quote.stable) continue;
    if (!(market.price > 0) || !(market.volume24h > 0)) continue;

    const incumbent = best.get(market.base);
    if (!incumbent || market.volume24h > incumbent.volume24h) {
      best.set(market.base, market);
    }
  }

  const rates: UsdRates = {};
  for (const [symbol, market] of best) rates[symbol] = market.price;
  return rates;
}
