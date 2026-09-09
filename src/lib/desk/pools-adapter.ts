import {
  DEFAULT_ALERT_CONFIG,
  buildBoard,
  type AlertConfig,
  type Board,
  type PoolObservation,
} from "@/lib/sim/opportunity";
import { buildPool } from "@/lib/sim/pools";

/**
 * Source for the opportunity board.
 *
 * A live implementation needs per-pool volume windows and LP event history,
 * which an RPC alone cannot serve at a usable speed — that is the indexer
 * integration named in INTEGRATIONS.md. Until it exists this returns
 * constructed pools, and the board says so.
 */
export interface PoolsSource {
  readonly isFixture: boolean;
  observe(): Promise<PoolObservation[]>;
}

const stock = (symbol: string) => ({ symbol, decimals: 18 });
const USDG = { symbol: "USDG", decimals: 6 };
const WETH = { symbol: "WETH", decimals: 18 };
/** Illustrative, like everything else here. The live source reads it off a pool. */
const WETH_USD = 3_100;

export class FixturePoolsSource implements PoolsSource {
  readonly isFixture = true;

  async observe(): Promise<PoolObservation[]> {
    const mk = (
      address: string,
      symbol: string,
      price: number,
      liquidity: bigint,
      fee: number,
      volume: PoolObservation["volume"],
      over: Partial<PoolObservation> = {},
    ): PoolObservation => ({
      address,
      pool: buildPool({ price, liquidity, fee, token0: stock(symbol), token1: USDG }),
      volume,
      peak24h: price * 1.08,
      ageMinutes: 900,
      hasHook: false,
      smartLpNet: 3,
      smartLpPresent: 4,
      smartLpExited1h: 0,
      quoteUsd: 1,
      ...over,
    });

    /**
     * A pool quoted in ether rather than in a dollar stablecoin.
     *
     * Its volume and depth are in WETH, so every figure it reports is three
     * orders of magnitude away from the thresholds it is judged against until
     * the rate is applied. It is here so the board always shows one.
     */
    const inEther = (
      address: string,
      symbol: string,
      priceUsd: number,
      liquidity: bigint,
      fee: number,
      volumeUsd: PoolObservation["volume"],
      over: Partial<PoolObservation> = {},
    ): PoolObservation => {
      const price = priceUsd / WETH_USD;
      return {
        address,
        pool: buildPool({ price, liquidity, fee, token0: stock(symbol), token1: WETH }),
        volume: {
          m5: volumeUsd.m5 / WETH_USD,
          h1: volumeUsd.h1 / WETH_USD,
          h6: volumeUsd.h6 / WETH_USD,
          h24: volumeUsd.h24 / WETH_USD,
        },
        peak24h: price * 1.06,
        ageMinutes: 900,
        hasHook: false,
        smartLpNet: 3,
        smartLpPresent: 4,
        smartLpExited1h: 0,
        quoteUsd: WETH_USD,
        ...over,
      };
    };

    return [
      mk("0x1a2b3c4d5e6f70819a2b3c4d5e6f7081", "BBBY", 0.42, 18_000n * 10n ** 12n, 3000,
        { m5: 22_000, h1: 310_000, h6: 1_400_000, h24: 4_900_000 },
        { smartLpNet: 6, smartLpPresent: 7 }),
      mk("0x2b3c4d5e6f70819a2b3c4d5e6f708192", "EXPR", 1.16, 44_000n * 10n ** 12n, 3000,
        { m5: 9_400, h1: 148_000, h6: 720_000, h24: 2_600_000 },
        { smartLpNet: 4, smartLpPresent: 5, smartLpExited1h: 1 }),
      mk("0x3c4d5e6f70819a2b3c4d5e6f70819a2b", "AMC", 3.05, 96_000n * 10n ** 12n, 500,
        { m5: 15_000, h1: 265_000, h6: 1_100_000, h24: 3_800_000 },
        { smartLpNet: 2, smartLpPresent: 3 }),
      mk("0x4d5e6f70819a2b3c4d5e6f70819a2b3c", "KOSS", 8.90, 6_000n * 10n ** 12n, 10000,
        { m5: 400, h1: 6_200, h6: 31_000, h24: 96_000 },
        { smartLpNet: 1, smartLpPresent: 1 }),
      mk("0x5e6f70819a2b3c4d5e6f70819a2b3c4d", "GME", 22.40, 1_900_000n * 10n ** 12n, 500,
        { m5: 41_000, h1: 690_000, h6: 3_600_000, h24: 14_000_000 },
        { smartLpNet: 5, smartLpPresent: 9 }),
      mk("0x6f70819a2b3c4d5e6f70819a2b3c4d5e", "NOK", 4.10, 31_000n * 10n ** 12n, 3000,
        { m5: 7_800, h1: 96_000, h6: 410_000, h24: 1_500_000 },
        { smartLpNet: -3, smartLpPresent: 0, smartLpExited1h: 4 }),
      mk("0x70819a2b3c4d5e6f70819a2b3c4d5e6f", "TLRY", 0.88, 12_000n * 10n ** 12n, 3000,
        { m5: 5_100, h1: 71_000, h6: 260_000, h24: 900_000 },
        { ageMinutes: 8, smartLpNet: 2, smartLpPresent: 2 }),
      mk("0x819a2b3c4d5e6f70819a2b3c4d5e6f70", "SNDL", 0.19, 9_000n * 10n ** 12n, 3000,
        { m5: 3_200, h1: 58_000, h6: 190_000, h24: 780_000 },
        { hasHook: true, smartLpNet: 2, smartLpPresent: 2 }),
      inEther("0x9a2b3c4d5e6f70819a2b3c4d5e6f7081", "MARA", 14.60, 260n * 10n ** 12n, 3000,
        { m5: 6_400, h1: 104_000, h6: 480_000, h24: 1_700_000 },
        { smartLpNet: 3, smartLpPresent: 4 }),
      // The same pool with nothing pricing its quote: held rather than measured.
      inEther("0xab2b3c4d5e6f70819a2b3c4d5e6f7081", "RIOT", 9.80, 190n * 10n ** 12n, 3000,
        { m5: 4_100, h1: 88_000, h6: 390_000, h24: 1_300_000 },
        { quoteUsd: undefined, smartLpNet: 2, smartLpPresent: 3 }),
    ];
  }
}

export type PoolsBoard = Board & { isFixture: boolean };

export async function loadBoard(
  source: PoolsSource,
  config: AlertConfig = DEFAULT_ALERT_CONFIG,
): Promise<PoolsBoard> {
  const observations = await source.observe();
  return { ...buildBoard(observations, config), isFixture: source.isFixture };
}

/**
 * The source the board should use, chosen from the environment.
 *
 * Live reads need an RPC and a watchlist, because v4 pools are addressed by a
 * key rather than discoverable from an address. RESIDENT_WATCHED_POOLS is a
 * JSON array of { key, token0, token1 } — see WatchedPool. With either missing
 * the board runs on fixtures and says so on screen.
 */
export async function getPoolsSource(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PoolsSource> {
  const rpcUrl = env.NEXT_PUBLIC_RPC_URL ?? env.RESIDENT_RPC_URL;
  const watchlist = env.RESIDENT_WATCHED_POOLS;
  if (!rpcUrl || !watchlist) return new FixturePoolsSource();

  try {
    const pools = JSON.parse(watchlist);
    if (!Array.isArray(pools) || pools.length === 0) return new FixturePoolsSource();
    const { RpcPoolsSource } = await import("./rpc-pools-source.ts");
    return new RpcPoolsSource(rpcUrl, pools);
  } catch (error) {
    // A malformed watchlist must not silently look like a quiet market. Fall
    // back to fixtures, which the UI labels, and say why in the log.
    console.error("RESIDENT_WATCHED_POOLS is not valid JSON:", error);
    return new FixturePoolsSource();
  }
}
