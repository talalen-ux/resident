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
      ...over,
    });

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
