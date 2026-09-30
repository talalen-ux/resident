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
 * Replay a log range in chunks the node will accept.
 *
 * `pauseMs` is between chunks, not inside them. Retrying after a 429 recovers
 * from a limit; a small pause avoids reaching one, and over a scan that is
 * hundreds of chunks long the difference is between a slow start and a start
 * that spends most of its time waiting out penalties.
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
  const out: { data: string; blockNumber: string; topics: string[] }[] = [];
  const total = Math.max(1, Math.ceil((toBlock - fromBlock + 1) / maxSpan));
  let done = 0;
  for (let start = fromBlock; start <= toBlock; start += maxSpan) {
    if (done > 0 && pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    const end = Math.min(start + maxSpan - 1, toBlock);
    const chunk = await rpc<typeof out>("eth_getLogs", [
      { address, topics, fromBlock: hex(start), toBlock: hex(end) },
    ]);
    out.push(...chunk);
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
  }

  async observe(): Promise<PoolObservation[]> {
    const observations = await this.read();

    // Price every non-stable quote asset off the chain's own markets, then
    // stamp each pool with what a unit of its quote is worth. Pools whose quote
    // cannot be priced keep quoteUsd undefined, which fails a gate rather than
    // being measured against dollar thresholds in the wrong unit.
    const rates = deriveRates(
      observations.map((o) => ({
        base: o.pool.token0.symbol,
        quote: o.pool.token1.symbol,
        price: spotPrice(o.pool),
        volume24h: o.volume.h24,
      })),
    );

    for (const o of observations) {
      const rate = usdPerQuote(o.pool.token1.symbol, rates);
      if (rate !== null) o.quoteUsd = rate;
    }

    return observations;
  }

  private async read(): Promise<PoolObservation[]> {
    const head = Number(BigInt(await this.rpc<string>("eth_blockNumber", [])));
    const spb = await secondsPerBlock(this.rpc, head);
    const blocksFor = (seconds: number) => Math.max(1, Math.round(seconds / spb));

    const reader = rpcReader(this.rpcUrl);
    const observations: PoolObservation[] = [];

    for (const watched of this.pools) {
      const id = poolId(watched.key);
      const pool = await readV4Pool(reader, watched.key, watched.token0, watched.token1);

      const from24h = Math.max(0, head - blocksFor(86_400));
      const logs = await getLogsChunked(
        this.rpc,
        this.poolManager,
        [V4_TOPICS.swap, id],
        from24h,
        head,
        this.maxBlockSpan,
      );

      // Swap data words: amount0, amount1, sqrtPriceX96, liquidity, tick, fee.
      // Volume is the quote side, so token1's amount, in its own decimals.
      const quoteDecimals = watched.token1.decimals;
      const scale = 10 ** quoteDecimals;
      const cut = {
        m5: head - blocksFor(300),
        h1: head - blocksFor(3_600),
        h6: head - blocksFor(21_600),
      };

      const volume: VolumeWindows = { m5: 0, h1: 0, h6: 0, h24: 0 };
      let peakSqrt = 0n;
      let swaps1h = 0;
      let flow1h = 0;
      const track: number[] = [];

      for (const log of logs) {
        const block = Number(BigInt(log.blockNumber));
        const amount1 = signedWord(log.data, 1);
        const traded = Number(amount1 < 0n ? -amount1 : amount1) / scale;

        volume.h24 += traded;
        if (block >= cut.h6) volume.h6 += traded;
        if (block >= cut.h1) volume.h1 += traded;
        if (block >= cut.m5) volume.m5 += traded;

        if (block >= cut.h1) {
          swaps1h++;
          // Sign is taken from the quote side: quote leaving the pool is the
          // token being bought. The convention is the pool's, so this is signed
          // the same way the pool signs it rather than the way it reads.
          flow1h += -Number(amount1) / scale;
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
        ageMinutes: await this.ageMinutes(id, head, spb),
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
      });
    }

    return observations;
  }

  /** Blocks back to the pool's Initialize event, bounded. */
  private async ageMinutes(id: string, head: number, spb: number) {
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
    // topics: [signature, id, currency0, currency1]
    const [, , t1, t2] = log.topics;
    if (!t1 || !t2) continue;
    const currency0 = `0x${t1.slice(-40)}`;
    const currency1 = `0x${t2.slice(-40)}`;

    // data: fee, tickSpacing, hooks, sqrtPriceX96, tick
    const fee = Number(signedWord(log.data, 0));
    const tickSpacing = Number(signedWord(log.data, 1));
    const hooks = `0x${log.data.slice(2).slice(2 * 64 + 24, 3 * 64)}`;

    const meta0 = tokenMeta(currency0, opts.extra);
    const meta1 = tokenMeta(currency1, opts.extra);
    if (!meta0 || !meta1) continue;

    const key = { currency0, currency1, fee, tickSpacing, hooks };
    found.set(poolId(key), { key, token0: meta0, token1: meta1 });
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
