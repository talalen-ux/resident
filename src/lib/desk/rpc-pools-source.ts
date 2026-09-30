import type { PoolObservation, VolumeWindows } from "../sim/opportunity.ts";
import type { PoolKey } from "../sim/v4.ts";
import { hasHook, poolId, readV4Pool, rpcReader } from "../sim/v4.ts";
import { spotPrice } from "../sim/v3.ts";
import type { TokenMeta } from "../sim/v3.ts";
import { TOKENS, UNISWAP, isTradable, tickerFor } from "../chain.ts";
import { deriveRates, usdPerQuote } from "./quotes.ts";
import { jsonRpc, type Rpc } from "./rpc-retry.ts";
import type { ExtraRegistry } from "./extra-tokens.ts";

import type { PoolsSource } from "./pools-adapter.ts";

/**
 * Live pool observations, read straight from the chain.
 *
 * The board needs two things an eth_call cannot give on its own: how much has
 * traded recently, and how old the pool is. Both are in the PoolManager's logs,
 * so this reads them with eth_getLogs rather than waiting on an indexer —
 * volume is the sum of the quote-side amounts on Swap events in the window, and
 * age comes from the pool's Initialize event.
 *
 * That removes the indexer from the critical path for everything except
 * liquidity-provider scoring, which needs per-wallet position history over
 * days and is left reporting "unknown" rather than guessed at.
 */

/**
 * Topic hashes, derived from the canonical signatures rather than transcribed:
 *
 *   Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)
 *   Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)
 *
 * A wrong topic hash does not error — it quietly returns no logs, which reads
 * as "this pool has no volume" and silently drops every candidate. test/v4-logs
 * pins both against ethers' own hashing for that reason.
 */
export const V4_TOPICS = {
  swap: "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  initialize:
    "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
} as const;

export type WatchedPool = {
  key: PoolKey;
  token0: TokenMeta;
  token1: TokenMeta;
  /**
   * The block the pool was initialised at, when discovery recorded it.
   *
   * Discovery finds pools by reading Initialize logs, and those logs say which
   * block. Searching for it again per pool — 25 chunked queries each, 150
   * pools a tick — was asking the node to tell us something already written
   * down.
   */
  block?: number;
};

export type RpcPoolsOptions = {
  poolManager?: string;
  /**
   * Most RPCs cap eth_getLogs at a block span or a log count. Requests are
   * chunked to this many blocks; lower it if the provider rejects a range.
   */
  maxBlockSpan?: number;
  /** Bound the Initialize search. A pool older than this reads as old enough. */
  ageSearchBlocks?: number;
  /** Most pools to read state for in one tick, busiest first. */
  maxPools?: number;
  /** Milliseconds between log chunks, to stay under the node's rate limit. */
  pauseMs?: number;
  /**
   * How far back each tick reads swaps. Default one hour.
   *
   * The board consumes the one-hour volume and the price series and nothing
   * longer, so a day's window fetched twenty-four times the data it used —
   * every minute, on a chain busy enough that a day of swaps does not fit in
   * one query and barely fits in memory. Longer buckets can only report what
   * the window covers, and `windowSeconds` on each observation says what that
   * was rather than letting h24 imply a day it never read.
   */
  windowSeconds?: number;
  /**
   * How far back the cheap unfiltered pass looks for pools that traded.
   * Default five minutes.
   */
  discoverySeconds?: number;
};

// The retrying caller, shared with the chain verifier. This file used to have
// its own, without retries, which is how a rate limit during pool discovery
// became an uncaught throw that killed the keeper before its first tick.

const hex = (n: number) => `0x${n.toString(16)}`;

/** Two's-complement read of one 32-byte word as a signed bigint. */
function signedWord(data: string, index: number): bigint {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  const raw = BigInt(`0x${body.slice(index * 64, (index + 1) * 64)}`);
  return raw >= 1n << 255n ? raw - (1n << 256n) : raw;
}

/**
 * Seconds per block, measured rather than assumed.
 *
 * Every window here is a duration, and turning a duration into a block range
 * needs the chain's actual cadence. Hard-coding it means every window silently
 * changes length the moment block time drifts.
 */
async function secondsPerBlock(rpc: Rpc, head: number, span = 2_000) {
  const from = Math.max(0, head - span);
  const [a, b] = await Promise.all([
    rpc<{ timestamp: string }>("eth_getBlockByNumber", [hex(from), false]),
    rpc<{ timestamp: string }>("eth_getBlockByNumber", [hex(head), false]),
  ]);
  const dt = Number(BigInt(b.timestamp) - BigInt(a.timestamp));
  const blocks = head - from;
  return blocks > 0 && dt > 0 ? dt / blocks : 2;
}

/**
 * The first block at which an address had code.
 *
 * Discovery replays Initialize logs, and there are none before the PoolManager
 * existed. Starting at genesis on a chain 76 million blocks old meant 7,657
 * chunked eth_getLogs calls to cover a span where the contract was not
 * deployed — the overwhelming majority of them asking an empty range, and
 * enough of them to earn a rate limit doing it.
 *
 * Binary search over eth_getCode finds the deployment in about 27 calls
 * instead. It needs a node that serves historical state; one that does not
 * answers with an error or an empty result at every height, and rather than
 * guess from that, the caller is told nothing was found and starts from zero
 * as before. Slow and correct beats fast and wrong about where to begin.
 */
export type DeployBlockResult =
  | { block: number }
  | { block: null; reason: string };

export async function firstBlockWithCode(
  rpc: Rpc,
  address: string,
  head: number,
): Promise<DeployBlockResult> {
  const hasCode = async (block: number) => {
    const code = await rpc<string>("eth_getCode", [address, hex(block)]);
    return typeof code === "string" && code.length > 2;
  };

  try {
    // No code at the head means the address is wrong, or the node is not
    // serving state. Either way this search has nothing to say.
    if (!(await hasCode(head))) {
      return { block: null, reason: `no code at ${address} on the latest block` };
    }
    // Code at genesis means a predeploy, and nothing to narrow.
    if (await hasCode(0)) return { block: 0 };
  } catch (error) {
    return { block: null, reason: describe(error) };
  }

  let low = 0;
  let high = head;
  try {
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (await hasCode(mid)) high = mid;
      else low = mid;
    }
  } catch (error) {
    return { block: null, reason: describe(error) };
  }
  return { block: high };
}

/**
 * Why the search gave up, in the caller's words rather than a stack trace.
 *
 * The distinction worth surfacing is between a node that will not serve
 * historical state and one that is merely busy: the first is permanent and
 * means setting RESIDENT_POOLS_FROM_BLOCK by hand, the second would have
 * worked on a quieter minute. Falling back silently made a 25-minute scan look
 * like the intended behaviour.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit|429/i.test(message)) {
    return `the node rate limited the search (${message})`;
  }
  if (/missing trie|state.*not available|unsupported|not supported|archive/i.test(message)) {
    return "the node does not serve historical state, so the deployment block cannot be found";
  }
  return message;
}

/**
 * True when the node refused a range for having too much in it.
 *
 * Distinct from a rate limit, and handled differently: waiting does not make a
 * range smaller. Phrasings differ between clients, so this matches the shape
 * rather than one vendor's wording.
 */
export const isTooManyResults = (message: string) =>
  /exceeds limit|more than \d+ results|query returned more than|too many results|response size exceeded|limit exceeded/i.test(
    message,
  );

/**
 * Replay a log range in chunks the node will accept.
 *
 * The block span is a guess and the node's real limit is on results, so a span
 * that works over quiet history fails the moment it reaches a busy stretch —
 * which is exactly where the logs worth having are. When a range comes back
 * "exceeds limit", it is halved and retried rather than abandoned: the only
 * thing wrong with it was its size, and the caller has no way to know the
 * right size in advance because it depends on how much traded.
 *
 * Splitting bottoms out at a single block. A block that alone exceeds the
 * limit cannot be subdivided further, and inventing a partial answer from it
 * would mean under-reporting volume as though the pool were quiet.
 *
 * `pauseMs` is between chunks, not inside them. Retrying after a 429 recovers
 * from a limit; a small pause avoids reaching one, and over a scan hundreds of
 * chunks long that is the difference between a slow start and a start that
 * spends most of its time serving out penalties.
 */
async function getLogsChunked(
  rpc: Rpc,
  address: string,
  topics: (string | null)[],
  fromBlock: number,
  toBlock: number,
  maxSpan: number,
  pauseMs = 0,
  onProgress?: (done: number, total: number) => void,
) {
  type Log = { data: string; blockNumber: string; topics: string[] };
  const out: Log[] = [];
  const total = Math.max(1, Math.ceil((toBlock - fromBlock + 1) / maxSpan));
  let done = 0;

  const fetchRange = async (start: number, end: number): Promise<void> => {
    try {
      const chunk = await rpc<Log[]>("eth_getLogs", [
        { address, topics, fromBlock: hex(start), toBlock: hex(end) },
      ]);
      out.push(...chunk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isTooManyResults(message) || start >= end) throw error;
      const mid = Math.floor((start + end) / 2);
      await fetchRange(start, mid);
      if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
      await fetchRange(mid + 1, end);
    }
  };

  for (let start = fromBlock; start <= toBlock; start += maxSpan) {
    if (done > 0 && pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    await fetchRange(start, Math.min(start + maxSpan - 1, toBlock));
    done++;
    onProgress?.(done, total);
  }
  return out;
}

export class RpcPoolsSource implements PoolsSource {
  readonly isFixture = false;

  // Declared and assigned rather than written as constructor parameter
  // properties: the test runner uses node's strip-only TypeScript mode, which
  // rejects that syntax outright.
  private readonly rpc: Rpc;
  private readonly rpcUrl: string;
  private readonly pools: WatchedPool[];
  private readonly poolManager: string;
  private readonly maxBlockSpan: number;
  private readonly ageSearchBlocks: number;
  private readonly maxPools: number;
  private readonly pauseMs: number;
  private readonly windowSeconds: number;
  private readonly discoverySeconds: number;
  /** Pools that traded in the window, before maxPools trimmed the tail. */
  lastActive = 0;

  constructor(
    rpcUrl: string,
    pools: WatchedPool[],
    opts: RpcPoolsOptions = {},
  ) {
    this.rpcUrl = rpcUrl;
    this.pools = pools;
    this.rpc = jsonRpc(rpcUrl);
    this.poolManager = opts.poolManager ?? UNISWAP.v4PoolManager;
    this.maxBlockSpan = opts.maxBlockSpan ?? 10_000;
    this.ageSearchBlocks = opts.ageSearchBlocks ?? 250_000;
    // State reads per tick. Each pool costs several calls, so this is the
    // number that decides whether a tick fits in its interval. The board only
    // ever acts on a handful and they are the ones with the flow, so the tail
    // costs nothing to be late to — while a tick that does not finish is a
    // desk that never decides anything at all.
    this.maxPools = opts.maxPools ?? 40;
    this.pauseMs = opts.pauseMs ?? 0;
    this.windowSeconds = opts.windowSeconds ?? 3_600;
    // The cheap question. Short enough that every swap on the chain over it is
    // a few thousand logs rather than a few hundred thousand.
    this.discoverySeconds = opts.discoverySeconds ?? 300;
  }

  async observe(): Promise<PoolObservation[]> {
    const observations = await this.read();

    // Price every non-stable quote asset off the chain's own markets, then
    // stamp each pool with what a unit of its quote is worth. Pools whose quote
    // cannot be priced keep quoteUsd undefined, which fails a gate rather than
    // being measured against dollar thresholds in the wrong unit.
    const rates = deriveRates(
      observations.map((o) => {
        // spotPrice is token1 per token0. When the quote is token0 the market
        // reads the other way round, and quoting it as-is would have every
        // stock priced in its own units.
        const quoteIsToken1 = !o.pool.stockIsToken1;
        const price = spotPrice(o.pool);
        return quoteIsToken1
          ? {
              base: o.pool.token0.symbol,
              quote: o.pool.token1.symbol,
              price,
              volume24h: o.volume.h24,
            }
          : {
              base: o.pool.token1.symbol,
              quote: o.pool.token0.symbol,
              price: price > 0 ? 1 / price : 0,
              volume24h: o.volume.h24,
            };
      }),
    );

    for (const o of observations) {
      const quote = o.pool.stockIsToken1 ? o.pool.token0 : o.pool.token1;
      const rate = usdPerQuote(quote.symbol, rates);
      if (rate !== null) o.quoteUsd = rate;
    }

    return observations;
  }

  /**
   * Two questions, not one.
   *
   * The first version of this read a day of every swap on the chain, once per
   * pool: about 73,000 requests a tick. The second read the same day in one
   * pass, which the node refused for size. The third read an hour in one pass,
   * which the node rate limited — an hour of every swap on a chain this busy
   * is hundreds of thousands of logs, split into hundreds of queries, fetched
   * every sixty seconds.
   *
   * Each of those was the same mistake: reading the whole chain to learn about
   * forty pools. The questions are different sizes and want asking separately.
   *
   *   who traded just now?   a short unfiltered window. Cheap, and the answer
   *                          is a list of pool ids.
   *   how much did they?     one filtered query per pool over the full window.
   *                          Tiny results, and only for pools that matter.
   *
   * A pool doing enough volume to rank is trading every few minutes, so the
   * short window finds it. One that traded once an hour ago and not since is
   * not a pool the desk wants to be quoting into anyway.
   */
  private async read(): Promise<PoolObservation[]> {
    const head = Number(BigInt(await this.rpc<string>("eth_blockNumber", [])));
    const spb = await secondsPerBlock(this.rpc, head);
    const blocksFor = (seconds: number) => Math.max(1, Math.round(seconds / spb));
    const window = Math.max(0, head - blocksFor(this.windowSeconds));
    const recent = Math.max(window, head - blocksFor(this.discoverySeconds));

    const watchedById = new Map(this.pools.map((w) => [poolId(w.key), w]));

    // Stage one: who has traded recently.
    const probe = await getLogsChunked(
      this.rpc,
      this.poolManager,
      [V4_TOPICS.swap],
      recent,
      head,
      this.maxBlockSpan,
      this.pauseMs,
    );

    const counts = new Map<string, number>();
    for (const log of probe) {
      const id = log.topics[1];
      if (!id || !watchedById.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    this.lastActive = counts.size;

    const active = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxPools)
      .map(([id]) => id);

    // Stage two: how much, over the full window, for those pools only.
    const reader = rpcReader(this.rpcUrl);
    const observations: PoolObservation[] = [];

    for (const id of active) {
      const watched = watchedById.get(id)!;
      const logs = await getLogsChunked(
        this.rpc,
        this.poolManager,
        [V4_TOPICS.swap, id],
        window,
        head,
        this.maxBlockSpan,
        this.pauseMs,
      );
      if (!logs.length) continue;

      const pool = await readV4Pool(reader, watched.key, watched.token0, watched.token1);

      // Uniswap orders a pool's tokens by address, so which side the quote
      // lands on is arbitrary. Roughly half the USDG pools on this chain have
      // USDG as token0, and reading token1 as the quote regardless measured
      // those in stock units and then failed to price them at all.
      const quoteIsToken1 = quoteSide(watched) === 1;
      const scale = 10 ** (quoteIsToken1 ? watched.token1.decimals : watched.token0.decimals);
      // Each cut is clamped to the window, so a bucket never claims a span
      // that was not read. With the default hour, h6 and h24 equal h1 — true,
      // and visible through windowSeconds rather than implied away.
      const cut = {
        m5: Math.max(window, head - blocksFor(300)),
        h1: Math.max(window, head - blocksFor(3_600)),
        h6: Math.max(window, head - blocksFor(21_600)),
      };

      const volume: VolumeWindows = { m5: 0, h1: 0, h6: 0, h24: 0 };
      let peakSqrt = 0n;
      let swaps1h = 0;
      let flow1h = 0;
      const track: number[] = [];

      for (const log of logs) {
        const block = Number(BigInt(log.blockNumber));
        // Swap data words: amount0, amount1, sqrtPriceX96, liquidity, tick, fee.
        const amountQuote = signedWord(log.data, quoteIsToken1 ? 1 : 0);
        const traded = Number(amountQuote < 0n ? -amountQuote : amountQuote) / scale;

        volume.h24 += traded;
        if (block >= cut.h6) volume.h6 += traded;
        if (block >= cut.h1) volume.h1 += traded;
        if (block >= cut.m5) volume.m5 += traded;

        if (block >= cut.h1) {
          swaps1h++;
          // Sign is taken from the quote side: quote leaving the pool is the
          // token being bought. The convention is the pool's, so this is signed
          // the same way the pool signs it rather than the way it reads.
          flow1h += -Number(amountQuote) / scale;
        }

        const sqrt = BigInt(`0x${log.data.slice(2).slice(2 * 64, 3 * 64)}`);
        if (sqrt > peakSqrt) peakSqrt = sqrt;
        track.push(priceFromSqrt(sqrt, watched));
      }

      observations.push({
        address: id,
        pool,
        volume,
        peak24h: peakSqrt > 0n ? priceFromSqrt(peakSqrt, watched) : 0,
        ageMinutes: await this.ageMinutes(id, head, spb, watched.block),
        hasHook: hasHook(watched.key),
        // Scoring who is winning needs per-wallet position history over days.
        // Zero here means "not measured", and the board's LPs-winning gate will
        // hold every pool until a history source is wired in — a stall, not a
        // silent pass.
        smartLpNet: 0,
        smartLpPresent: 0,
        smartLpExited1h: 0,
        prices: samplePrices(track, 120),
        swaps1h,
        flow1h,
        windowSeconds: this.windowSeconds,
      });
    }

    return observations;
  }

  /** Blocks back to the pool's Initialize event, bounded. */
  private async ageMinutes(id: string, head: number, spb: number, known?: number) {
    // Discovery already read the Initialize log that created this pool, and
    // that log carried its block. Asking the node again — 25 chunked queries
    // per pool, 150 pools a tick — was the largest single cost in a tick, for
    // a number already on disk.
    if (known !== undefined && known > 0) return ((head - known) * spb) / 60;

    const from = Math.max(0, head - this.ageSearchBlocks);
    const logs = await getLogsChunked(
      this.rpc,
      this.poolManager,
      [V4_TOPICS.initialize, id],
      from,
      head,
      this.maxBlockSpan,
    );
    if (!logs.length) {
      // Not initialised inside the search window, so it is older than the
      // window — which is all the age gate needs to know.
      return (this.ageSearchBlocks * spb) / 60;
    }
    const at = Number(BigInt(logs[0].blockNumber));
    return ((head - at) * spb) / 60;
  }
}

/**
 * Thin a per-swap price track down to at most `count` evenly spaced points.
 *
 * The ranging test measures how much of the history sat inside a band, so a
 * pool with ten thousand swaps and one with fifty must not be weighted by how
 * heavily they traded. Even spacing in TIME is what the test wants; even
 * spacing in swaps is what is cheap to get, and on a pool active enough to
 * provide liquidity to the two are close. It is an approximation, and it is
 * why the gate is a floor rather than a score.
 */
function samplePrices(track: number[], count: number): number[] {
  if (track.length <= count) return track;
  const step = track.length / count;
  return Array.from({ length: count }, (_, i) => track[Math.floor(i * step)]);
}

/** Quote price per whole stock token, from a sqrtPriceX96. */
function priceFromSqrt(sqrtPriceX96: bigint, watched: WatchedPool) {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const raw = ratio * ratio;
  return raw * 10 ** (watched.token0.decimals - watched.token1.decimals);
}

/**
 * Find every pool on the chain, from the PoolManager's own Initialize events.
 *
 * This is the answer to "do I need an indexer to know what to watch": no. A v4
 * pool is addressed by its key rather than by an address, and the key is
 * exactly what Initialize carries — currency0 and currency1 indexed, fee,
 * tickSpacing and hooks in the data. Replaying those logs reconstructs every
 * key that has ever existed without asking anyone.
 *
 * An indexer is a thing that has already read these logs and kept them. Reading
 * them yourself costs requests and time, not capability. What an indexer buys
 * is not access — it is not having to re-read history on every start.
 *
 * Pools are filtered to the canonical registry, because a pool whose tokens are
 * not the real equity is not a candidate however it prices — see isCanonical.
 */
export async function discoverPools(
  rpcUrl: string,
  opts: RpcPoolsOptions & {
    fromBlock?: number;
    toBlock?: number;
    /** Tokens allowed beyond the canonical registry. See extra-tokens.ts. */
    extra?: ExtraRegistry;
    /** Milliseconds between chunks, to stay under the node's rate limit. */
    pauseMs?: number;
    /** Told about each chunk, so a long scan reports progress rather than hanging. */
    onProgress?: (done: number, total: number) => void;
    /**
     * Told where the venue was deployed, or why that could not be established.
     * A silent fallback to genesis makes a 25-minute scan look intended.
     */
    onDeployBlock?: (block: number | null, reason?: string) => void;
  } = {},
): Promise<WatchedPool[]> {
  const rpc = jsonRpc(rpcUrl, {
    onRetry: ({ status, attempt, waitMs }) =>
      opts.onProgress === undefined
        ? undefined
        : console.log(`    rpc ${status}, retry ${attempt} in ${waitMs}ms`),
  });
  const poolManager = opts.poolManager ?? UNISWAP.v4PoolManager;
  const maxSpan = opts.maxBlockSpan ?? 10_000;

  const head =
    opts.toBlock ?? Number(BigInt(await rpc<string>("eth_blockNumber", [])));

  // An explicit floor wins. Otherwise find where the PoolManager was deployed,
  // because every Initialize log is after that and everything before it is a
  // request that can only return nothing.
  let from = opts.fromBlock ?? 0;
  if (opts.fromBlock === undefined) {
    const found = await firstBlockWithCode(rpc, poolManager, head);
    if (found.block !== null) {
      from = found.block;
      opts.onDeployBlock?.(found.block);
    } else {
      opts.onDeployBlock?.(null, found.reason);
    }
  }

  const logs = await getLogsChunked(
    rpc,
    poolManager,
    [V4_TOPICS.initialize],
    from,
    head,
    maxSpan,
    opts.pauseMs ?? 0,
    opts.onProgress,
  );

  const found = new Map<string, WatchedPool>();

  for (const log of logs) {
    const raw = rawFrom(log);
    if (!raw) continue;
    const { currency0, currency1, fee, tickSpacing, hooks } = raw.key;

    const meta0 = tokenMeta(currency0, opts.extra);
    const meta1 = tokenMeta(currency1, opts.extra);
    if (!meta0 || !meta1) continue;

    const key = { currency0, currency1, fee, tickSpacing, hooks };
    found.set(poolId(key), { key, token0: meta0, token1: meta1 });
  }

  return [...found.values()];
}

/**
 * Which side of a pool is the quote asset: 0 or 1.
 *
 * Uniswap orders currencies by address, so a USDG pool is as likely to have
 * USDG as token0 as token1. Everything that measures volume, prices a quote or
 * sizes a position has to agree about which side that is, so it is decided
 * here rather than assumed in each of them.
 */
export function quoteSide(pool: { token0: TokenMeta; token1: TokenMeta }): 0 | 1 {
  const quoteish = (symbol: string) => symbol === "USDG" || symbol === "WETH";
  if (quoteish(pool.token1.symbol)) return 1;
  if (quoteish(pool.token0.symbol)) return 0;
  // Neither side is a quote the desk knows. Keep the old orientation so the
  // figures are at least consistent; the pricing gate drops it either way.
  return 1;
}

/** One pool, as the chain described it, before any token set had an opinion. */
export type RawPool = { key: PoolKey; block: number };

/** Decode an Initialize log, or null if it is not one we can read. */
function rawFrom(log: { data: string; blockNumber?: string; topics: string[] }): RawPool | null {
  // topics: [signature, id, currency0, currency1]
  const [, , t1, t2] = log.topics;
  if (!t1 || !t2) return null;
  const currency0 = `0x${t1.slice(-40)}`;
  const currency1 = `0x${t2.slice(-40)}`;

  // data: fee, tickSpacing, hooks, sqrtPriceX96, tick
  const fee = Number(signedWord(log.data, 0));
  const tickSpacing = Number(signedWord(log.data, 1));
  const hooks = `0x${log.data.slice(2).slice(2 * 64 + 24, 3 * 64)}`;

  return {
    key: { currency0, currency1, fee, tickSpacing, hooks },
    block: log.blockNumber ? Number(BigInt(log.blockNumber)) : 0,
  };
}

/**
 * Every pool the chain has, unfiltered, and how far the scan got.
 *
 * Kept separate from the token filter on purpose. Discovery is the expensive
 * half — thousands of chunked eth_getLogs calls — and the filter is free. When
 * the two were one step, the cache held only what that day's token set
 * allowed, so allowing a new token meant replaying the entire chain to find
 * pools the scan had already seen and thrown away.
 *
 * Cache what the chain said. Decide what to do with it on every boot.
 */
export async function discoverRawPools(
  rpcUrl: string,
  opts: RpcPoolsOptions & {
    fromBlock?: number;
    toBlock?: number;
    pauseMs?: number;
    onProgress?: (done: number, total: number) => void;
    onDeployBlock?: (block: number | null, reason?: string) => void;
  } = {},
): Promise<{ pools: RawPool[]; scannedTo: number }> {
  const rpc = jsonRpc(rpcUrl);
  const poolManager = opts.poolManager ?? UNISWAP.v4PoolManager;
  const maxSpan = opts.maxBlockSpan ?? 10_000;

  const head =
    opts.toBlock ?? Number(BigInt(await rpc<string>("eth_blockNumber", [])));

  let from = opts.fromBlock ?? 0;
  if (opts.fromBlock === undefined) {
    const deployed = await firstBlockWithCode(rpc, poolManager, head);
    if (deployed.block !== null) {
      from = deployed.block;
      opts.onDeployBlock?.(deployed.block);
    } else {
      opts.onDeployBlock?.(null, deployed.reason);
    }
  }

  if (from > head) return { pools: [], scannedTo: head };

  const logs = await getLogsChunked(
    rpc,
    poolManager,
    [V4_TOPICS.initialize],
    from,
    head,
    maxSpan,
    opts.pauseMs ?? 0,
    opts.onProgress,
  );

  // Kept only if one side is a token the desk already knows.
  //
  // A chain this size is mostly pools of one spam token against another, and
  // 936,697 of them is a cache the next boot has to parse before it can do
  // anything. The filter is not thrift, it is the same rule the board runs on:
  // a position needs a quote asset that can be priced, and a pool with neither
  // side known has none. Everything realistically addable later — the volume
  // leaders are quoted in USDG or WETH — has a known side today.
  const pools = [];
  for (const log of logs) {
    const raw = rawFrom(log);
    if (!raw) continue;
    if (!tokenMeta(raw.key.currency0) && !tokenMeta(raw.key.currency1)) continue;
    pools.push(raw);
  }
  return { pools, scannedTo: head };
}

/**
 * The pools the desk can actually watch, given the tokens it is allowed.
 *
 * Free, so it runs every boot against the whole cache rather than being baked
 * into it. Allowing a token is then a restart, not a rescan.
 */
export function watchable(raw: RawPool[], extra?: ExtraRegistry): WatchedPool[] {
  const found = new Map<string, WatchedPool>();
  for (const { key, block } of raw) {
    const token0 = tokenMeta(key.currency0, extra);
    const token1 = tokenMeta(key.currency1, extra);
    if (!token0 || !token1) continue;
    found.set(poolId(key), { key, token0, token1, block });
  }
  return [...found.values()];
}

/**
 * Symbol and decimals for a canonical address, or null.
 *
 * Null is a rejection, not a gap to fill with a default: a pool paired against
 * a token that is not in the registry is not a candidate, and guessing 18
 * decimals for an unknown token silently mis-scales every figure downstream.
 */
function tokenMeta(address: string, extra?: ExtraRegistry): TokenMeta | null {
  const lower = address.toLowerCase();
  if (lower === TOKENS.usdg.toLowerCase()) {
    return { symbol: "USDG", decimals: 6, address: lower };
  }
  if (lower === TOKENS.weth.toLowerCase()) {
    return { symbol: "WETH", decimals: 18, address: lower };
  }

  const ticker = tickerFor(address);
  if (ticker && isTradable(address)) {
    return { symbol: ticker, decimals: 18, address: lower };
  }

  // The operator's own tier, whose symbols and decimals were read off the
  // chain at startup rather than assumed. Consulted last so a canonical token
  // can never be shadowed by an entry in a variable.
  return extra?.get(lower) ?? null;
}
