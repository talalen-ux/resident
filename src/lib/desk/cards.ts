/**
 * The cards the positions page renders, from whichever source is available.
 *
 * Two producers, one shape. {@link cardsFromLive} is the real one and is pure —
 * observations, positions and the keeper's journal go in, cards come out — so
 * every field it computes is testable without a chain. {@link fixtureCards} is
 * the illustrative one, and the page it feeds says so above the numbers.
 *
 * The two are kept in one file on purpose. A fixture that drifts out of the
 * shape the live path produces is a page that renders in review and breaks the
 * day it is pointed at a chain.
 */

import type { PoolObservation } from "../sim/opportunity.ts";
import { spotPrice } from "../sim/v3.ts";
import { seriesFrom } from "../keeper/marks.ts";
import type { JournalRecord, KeeperPosition } from "../keeper/types.ts";
import { buildCard, type Card, type CardPosition } from "./telemetry.ts";
import type { Quote } from "./reference.ts";

export type { Card } from "./telemetry.ts";

/** Six hours, the window the net figure covers. */
export const NET_WINDOW_MS = 6 * 60 * 60 * 1000;

export type LiveCardsInput = {
  /** Every pool being watched, priced this tick. */
  observations: PoolObservation[];
  /** Pair label per observation address, e.g. "AMC/USDG". */
  pairs: Record<string, string>;
  /** Base and quote token addresses per observation, for the reference. */
  tokens: Record<string, { base: string; quote: string }>;
  /** What the keeper holds, from its journal. */
  positions: KeeperPosition[];
  /** The journal, for marks and sweeps. */
  records: JournalRecord[];
  now: number;
  captureEfficiency?: number;
};

/**
 * Build a card per watched pool.
 *
 * Pools we hold nothing in still get a card. That is the difference between a
 * portfolio page and a desk: the pool we are about to enter is the one worth
 * looking at, and a page that only shows what is already open cannot show why
 * anything was opened.
 */
export function cardsFromLive(input: LiveCardsInput): Card[] {
  const series = seriesFrom(input.records);
  const held = new Map(input.positions.map((p) => [p.pool, p]));

  const quotes: Quote[] = input.observations.map((obs) =>
    quoteFor(obs, input.tokens[obs.address]),
  );

  return input.observations.map((obs, index) => {
    const pair = input.pairs[obs.address] ?? obs.address;
    const position = held.get(pair) ?? null;

    return buildCard({
      observation: obs,
      pair,
      peers: quotes,
      self: quotes[index],
      position: position ? toCardPosition(position, input.now) : null,
      series: position ? (series.get(position.id) ?? null) : null,
      netWindowMs: NET_WINDOW_MS,
      netWindowLabel: "6h",
      now: input.now,
      captureEfficiency: input.captureEfficiency ?? 1,
    });
  });
}

function toCardPosition(position: KeeperPosition, now: number): CardPosition {
  return {
    capital: position.capital,
    lower: position.lower,
    upper: position.upper,
    // The card's fees-inside comes from the latest mark, which buildCard reads
    // out of the series. Zero here means "not marked yet", and it renders as
    // the position having earned nothing since it opened — which is true.
    feesInside: 0,
    shape: position.shape,
    binCount: position.binCount,
    sinceSweepMs: Math.max(0, now - position.lastSweptAt),
  };
}

function quoteFor(
  obs: PoolObservation,
  tokens: { base: string; quote: string } | undefined,
): Quote {
  return {
    address: obs.address,
    base: (tokens?.base ?? obs.pool.token0.symbol).toLowerCase(),
    quote: (tokens?.quote ?? obs.pool.token1.symbol).toLowerCase(),
    price: spotPrice(obs.pool),
    volume24h: obs.volume.h24,
  };
}

/**
 * Illustrative cards.
 *
 * Every figure invented, in the same shape the live path produces. The page
 * that renders them carries an unmissable banner saying so; showing invented
 * numbers on a public page without one would be worse than showing nothing.
 */
export function fixtureCards(): Card[] {
  const rows: Array<{
    pair: string;
    mark: number;
    lower: number;
    upper: number;
    capital: number;
    fees1h: number;
    fees24h: number;
    feesInside: number;
    share: number;
    swaps: number;
    flow: number;
    deviation: number;
    sources: number;
    fees6h: number;
    principal6h: number;
    smart: { net: number; present: number; exited1h: number };
    sweptMinutes: number;
  }> = [
    { pair: "BBBY/USDG", mark: 4.21, lower: 3.96, upper: 4.44, capital: 9_800, fees1h: 14.2, fees24h: 318.4, feesInside: 41.3, share: 0.11, swaps: 62, flow: -8_400, deviation: 0.004, sources: 3, fees6h: 88.1, principal6h: -31.4, smart: { net: 4, present: 6, exited1h: 1 }, sweptMinutes: 3 },
    { pair: "EXPR/USDG", mark: 11.61, lower: 10.94, upper: 12.26, capital: 7_400, fees1h: 9.8, fees24h: 241.0, feesInside: 26.8, share: 0.08, swaps: 41, flow: 3_120, deviation: -0.011, sources: 2, fees6h: 57.6, principal6h: 12.9, smart: { net: 2, present: 4, exited1h: 0 }, sweptMinutes: 8 },
    { pair: "AMC/USDG", mark: 30.52, lower: 29.10, upper: 32.10, capital: 11_200, fees1h: 11.4, fees24h: 289.6, feesInside: 33.1, share: 0.05, swaps: 88, flow: -1_940, deviation: 0.002, sources: 4, fees6h: 69.2, principal6h: -104.8, smart: { net: 1, present: 5, exited1h: 2 }, sweptMinutes: 1 },
    { pair: "KOSS/USDG", mark: 93.10, lower: 81.20, upper: 90.40, capital: 4_600, fees1h: 0, fees24h: 96.2, feesInside: 0, share: 0.14, swaps: 6, flow: 260, deviation: 0.061, sources: 2, fees6h: 4.1, principal6h: -212.6, smart: { net: -2, present: 1, exited1h: 3 }, sweptMinutes: 47 },
  ];

  return rows.map((row) => {
    const span = row.upper - row.lower;
    const raw = span > 0 ? (row.mark - row.lower) / span : 0.5;
    const clamped = Math.min(1, Math.max(0, raw));
    const net = row.fees6h + row.principal6h;

    return {
      pair: row.pair,
      address: `0x${row.pair.slice(0, 4).toLowerCase()}`,
      mark: row.mark,
      fees1h: row.fees1h,
      fees24h: row.fees24h,
      atWork: row.capital,
      range: {
        lower: row.lower,
        upper: row.upper,
        price: row.mark,
        position: clamped,
        inRange: row.mark >= row.lower && row.mark <= row.upper,
      },
      feesInside: row.feesInside,
      ourShare: row.share,
      swapsPerHour: row.swaps,
      flow1h: row.flow,
      split: splitFromPosition(row.lower, row.upper, row.mark),
      vsReference: {
        deviation: row.deviation,
        sources: row.sources,
        stale: Math.abs(row.deviation) > 0.03,
      },
      net: {
        window: "6h",
        fees: row.fees6h,
        principal: row.principal6h,
        net,
        rate: net / row.capital,
      },
      smartLp: row.smart,
      sinceSweepMs: row.sweptMinutes * 60_000,
    } satisfies Card;
  });
}

function splitFromPosition(lower: number, upper: number, price: number) {
  const a = Math.sqrt(lower);
  const b = Math.sqrt(upper);
  const s = Math.min(b, Math.max(a, Math.sqrt(price)));
  const quote = s - a;
  const base = s - (s * s) / b;
  const total = quote + base;
  if (!(total > 0)) return { quote: 1, base: 0 };
  return { quote: quote / total, base: base / total };
}
