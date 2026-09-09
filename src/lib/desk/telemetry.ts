/**
 * One pool, as a card.
 *
 * Every field here answers a question an operator asks in the first two seconds
 * of looking at a position: is it earning, is it in range, is the price real,
 * how much of the pool is ours, and — the one most dashboards leave out — is it
 * actually ahead after what the price move cost.
 *
 * Nothing is defaulted. A field that cannot be computed from what was passed in
 * is null, and the card renders it as unmeasured rather than as zero. A zero in
 * a "fees" row and a zero in a "we did not look" row are different facts, and a
 * card that shows them identically is worse than one that shows fewer fields.
 */

import {
  bandShare,
  liquidityInBand,
  type PoolObservation,
} from "../sim/opportunity.ts";
import { spotPrice } from "../sim/v3.ts";
import { binWeights, type LiquidityShape, type PositionSide } from "../sim/dlmm.ts";
import { deviationFrom, referenceFor, type Quote } from "./reference.ts";
import { netOverWindow, netReturn, type PositionSeries } from "../keeper/marks.ts";

export type CardPosition = {
  /** Capital committed, in quote units. */
  capital: number;
  lower: number;
  upper: number;
  /** Unswept fees inside the position, in quote units. */
  feesInside: number;
  /** DLMM only. */
  shape?: LiquidityShape;
  binCount?: number;
  side?: PositionSide;
  /** Milliseconds since the last sweep. */
  sinceSweepMs: number;
};

export type RangeBar = {
  lower: number;
  upper: number;
  price: number;
  /** Where the price sits in the range, 0 at the lower bound and 1 at the upper. */
  position: number;
  inRange: boolean;
};

export type Split = {
  /** Fraction of the position's value held as the quote asset. */
  quote: number;
  /** Fraction held as the base token. */
  base: number;
};

export type Card = {
  pair: string;
  address: string;
  /** Pool price in quote units. */
  mark: number;
  fees1h: number | null;
  fees24h: number | null;
  atWork: number | null;
  range: RangeBar | null;
  feesInside: number | null;
  /** Our share of the liquidity competing where the price is. */
  ourShare: number | null;
  swapsPerHour: number | null;
  /** Signed quote flow over the last hour. Positive is net buying. */
  flow1h: number | null;
  split: Split | null;
  /** How far this pool is from the same pair elsewhere. */
  vsReference: { deviation: number; sources: number; stale: boolean } | null;
  /** Fees less what the principal lost, over the window. */
  net: { window: string; fees: number; principal: number; net: number; rate: number | null } | null;
  smartLp: { net: number; present: number; exited1h: number };
  /** Milliseconds since the last sweep, or null when nothing is open. */
  sinceSweepMs: number | null;
};

export type CardInput = {
  observation: PoolObservation;
  pair: string;
  /** Every pool being watched, for the off-pool reference. */
  peers: Quote[];
  /** This pool as a quote, so it can be excluded from its own reference. */
  self: Quote;
  /** The position we hold here, or null. */
  position: CardPosition | null;
  /** Marks and sweeps for that position, for the net figure. */
  series: PositionSeries | null;
  /** Window the net figure covers, in milliseconds. */
  netWindowMs: number;
  netWindowLabel: string;
  now: number;
  /** Fraction of the naive fee estimate assumed captured. */
  captureEfficiency: number;
};

/**
 * Build one card.
 *
 * The fee figures are estimates from volume and share, not amounts collected —
 * the collected amount is what the sweep records, and it arrives later. They
 * are labelled as fees on the card because that is what an operator means by
 * the word, and the number that is actually banked is the net figure below,
 * which comes from marks.
 */
export function buildCard(input: CardInput): Card {
  const { observation: obs, position } = input;
  const mark = spotPrice(obs.pool);

  // Our share of what is competing for the fee where the price actually is.
  // Measured over the position's own half-width rather than a fixed band: a
  // tight position competes with less liquidity and earns a larger share of it,
  // and a card that reports both against the same fixed band understates
  // exactly the positions that were placed carefully.
  const share = position ? shareOf(obs, position, mark) : null;

  const feeRate =
    share === null
      ? null
      : (obs.pool.fee / 1_000_000) * share * input.captureEfficiency;

  const reference = referenceFor(input.self, input.peers);
  const vs = deviationFrom(mark, reference);

  const net =
    input.series && input.netWindowMs > 0
      ? netOverWindow(input.series, input.netWindowMs, input.now)
      : null;

  return {
    pair: input.pair,
    address: obs.address,
    mark,
    fees1h: feeRate === null ? null : obs.volume.h1 * feeRate,
    fees24h: feeRate === null ? null : obs.volume.h24 * feeRate,
    atWork: position?.capital ?? null,
    range: position ? rangeBar(position, mark) : null,
    feesInside: position?.feesInside ?? null,
    ourShare: share,
    swapsPerHour: obs.swaps1h ?? null,
    flow1h: obs.flow1h ?? null,
    split: position ? splitAt(position, mark) : null,
    vsReference: vs
      ? {
          deviation: vs.deviation,
          sources: vs.reference.sources,
          stale: vs.stale,
        }
      : null,
    net: net
      ? {
          window: input.netWindowLabel,
          fees: net.fees,
          principal: net.principalChange,
          net: net.net,
          rate: netReturn(net),
        }
      : null,
    smartLp: {
      net: obs.smartLpNet,
      present: obs.smartLpPresent,
      exited1h: obs.smartLpExited1h,
    },
    sinceSweepMs: position?.sinceSweepMs ?? null,
  };
}

/**
 * Our share of the liquidity competing where the price is.
 *
 * The competing amount is measured over the position's own half-width, and our
 * own capital is taken back out of it — a pool observation includes us, and
 * counting ourselves as competition understates the share by exactly the
 * amount that matters most on a thin pool.
 */
function shareOf(
  obs: PoolObservation,
  position: CardPosition,
  price: number,
): number | null {
  if (!(price > 0) || !(position.upper > position.lower)) return null;
  const halfWidth = (position.upper - position.lower) / 2 / price;
  if (!(halfWidth > 0)) return null;
  const competing = Math.max(
    0,
    liquidityInBand(obs.pool, halfWidth) - position.capital,
  );
  return bandShare(position.capital, competing);
}

function rangeBar(position: CardPosition, price: number): RangeBar {
  const span = position.upper - position.lower;
  const raw = span > 0 ? (price - position.lower) / span : 0;
  return {
    lower: position.lower,
    upper: position.upper,
    price,
    position: Math.min(1, Math.max(0, raw)),
    inRange: price >= position.lower && price <= position.upper,
  };
}

/**
 * How much of the position is quote and how much is the token.
 *
 * A concentrated position is all quote at the bottom of its range and all base
 * at the top, and where it sits between them is the operator's real exposure —
 * not the notional. A card that shows capital without the split shows a
 * position as $10k of "capital" while it is in fact $10k of a token that just
 * fell 30% into the range.
 */
export function splitAt(position: CardPosition, price: number): Split {
  if (position.binCount && position.side) {
    // DLMM: bins below the active one hold quote, bins above hold base.
    const weights = binWeights(position.shape ?? "spot", position.binCount);
    const span = position.upper - position.lower;
    const at = span > 0 ? (price - position.lower) / span : 0.5;
    const activeIndex = Math.round(at * (weights.length - 1));
    let quote = 0;
    for (let i = 0; i < weights.length; i++) {
      if (i < activeIndex) quote += weights[i];
    }
    return { quote: clamp01(quote), base: clamp01(1 - quote) };
  }

  const a = Math.sqrt(Math.max(0, position.lower));
  const b = Math.sqrt(Math.max(0, position.upper));
  const s = Math.min(b, Math.max(a, Math.sqrt(Math.max(0, price))));
  if (!(b > a)) return { quote: 1, base: 0 };

  // amount1 (quote) = L(s − a); amount0 (base) valued in quote = L(s − s²/b).
  // The liquidity constant cancels, which is why this needs no position size.
  const quoteValue = s - a;
  const baseValue = s - (s * s) / b;
  const total = quoteValue + baseValue;
  if (!(total > 0)) return { quote: 1, base: 0 };
  return { quote: clamp01(quoteValue / total), base: clamp01(baseValue / total) };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type FeedStatus = {
  /** Milliseconds since the keeper last reported healthy. */
  sinceHeartbeatMs: number;
  live: boolean;
  note: string;
};

/**
 * Whether what the page is showing is current.
 *
 * A dashboard whose keeper died an hour ago looks exactly like one whose keeper
 * is fine and whose pools are quiet. This is the difference, and it belongs at
 * the top of the page rather than in a log.
 */
export function feedStatus(
  lastHealthyAt: number,
  now: number,
  staleAfterMs = 180_000,
): FeedStatus {
  const since = Math.max(0, now - lastHealthyAt);
  if (lastHealthyAt === 0) {
    return { sinceHeartbeatMs: since, live: false, note: "never ran" };
  }
  const live = since <= staleAfterMs;
  return {
    sinceHeartbeatMs: since,
    live,
    note: live
      ? `swept ${Math.round(since / 1000)}s ago`
      : `no heartbeat for ${Math.round(since / 60_000)} minutes`,
  };
}
