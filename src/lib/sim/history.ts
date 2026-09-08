/**
 * Pool history: what the backtest replays.
 *
 * One interval of a single pool. `liquidity` is quote-denominated liquidity
 * within the band width being tested, which is what a competing band actually
 * dilutes against — not the raw `liquidity` slot on the pool.
 */
export type Candle = {
  /** Interval start, ms since epoch. */
  t: number;
  /** Pool price, quote per token0. */
  price: number;
  /** Reference price P̂ for the same instant. Null outside the primary session. */
  reference: number | null;
  /** Quote volume traded in the interval. */
  volume: number;
  /** Quote-denominated liquidity within the band width. */
  liquidity: number;
};

export type PoolHistory = {
  pool: string;
  pair: string;
  /** Fee in hundredths of a bip: 3000 = 0.3%. */
  feePips: number;
  intervalMs: number;
  candles: Candle[];
};

export interface HistorySource {
  readonly isSynthetic: boolean;
  load(pool: string, fromMs: number, toMs: number): Promise<PoolHistory>;
  list(): Promise<string[]>;
}

/**
 * Indexer-backed source.
 *
 * Not implemented: it needs the indexer named in INTEGRATIONS.md. The shape is
 * fixed here so the backtest does not have to change when it arrives — supply
 * a function that answers the query and the engine runs unmodified.
 */
export class IndexerHistorySource implements HistorySource {
  readonly isSynthetic = false;
  private readonly fetchCandles: (
    pool: string,
    fromMs: number,
    toMs: number,
  ) => Promise<PoolHistory>;

  constructor(fetchCandles: IndexerHistorySource["fetchCandles"]) {
    this.fetchCandles = fetchCandles;
  }

  load(pool: string, fromMs: number, toMs: number) {
    return this.fetchCandles(pool, fromMs, toMs);
  }

  async list(): Promise<string[]> {
    throw new Error("IndexerHistorySource.list requires the indexer — see INTEGRATIONS.md");
  }
}

/** Deterministic PRNG, so a synthetic run is reproducible from its seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SyntheticSpec = {
  pair: string;
  feePips: number;
  startPrice: number;
  /** Per-interval log-return standard deviation. */
  vol: number;
  /** Probability per interval of a dislocation spike. */
  spikeProb: number;
  /** Spike size as a fraction, applied to the pool price only. */
  spikeSize: number;
  /** Intervals a spike takes to decay back toward reference. */
  spikeDecay: number;
  baseVolume: number;
  baseLiquidity: number;
  intervals: number;
  intervalMs: number;
  seed: number;
};

/**
 * Synthetic history, for exercising the engine where no indexer exists.
 *
 * This is NOT evidence about real pools. It generates a reference price by
 * random walk, a pool price that tracks it with noise plus occasional spikes,
 * and volume that rises with activity. Its only job is to prove the backtest
 * computes what it claims on a series whose properties are known by
 * construction — including that spikes are present to be found.
 */
export class SyntheticHistorySource implements HistorySource {
  readonly isSynthetic = true;
  private readonly specs: Record<string, SyntheticSpec>;

  constructor(specs: Record<string, SyntheticSpec>) {
    this.specs = specs;
  }

  async list() {
    return Object.keys(this.specs);
  }

  async load(pool: string, fromMs: number): Promise<PoolHistory> {
    const spec = this.specs[pool];
    if (!spec) throw new Error(`no synthetic spec for ${pool}`);
    const rand = mulberry32(spec.seed);
    const candles: Candle[] = [];

    let reference = spec.startPrice;
    let dislocation = 0; // pool premium over reference, decaying

    for (let i = 0; i < spec.intervals; i++) {
      // Reference walks; the pool tracks it plus any live dislocation.
      const shock = (rand() * 2 - 1) * spec.vol;
      reference *= Math.exp(shock);

      if (rand() < spec.spikeProb) dislocation += spec.spikeSize;
      dislocation *= Math.exp(-1 / Math.max(1, spec.spikeDecay));

      const price = reference * (1 + dislocation);
      const activity = 1 + Math.abs(shock) / spec.vol + dislocation * 4;

      candles.push({
        t: fromMs + i * spec.intervalMs,
        price,
        reference,
        volume: spec.baseVolume * activity * (0.5 + rand()),
        liquidity: spec.baseLiquidity * (0.8 + rand() * 0.4),
      });
    }

    return {
      pool,
      pair: spec.pair,
      feePips: spec.feePips,
      intervalMs: spec.intervalMs,
      candles,
    };
  }
}
