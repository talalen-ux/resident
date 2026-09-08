import type { DeskAdapter, DeskSnapshot } from "./types";

/**
 * Fixture adapter.
 *
 * The dashboard ships pointed at this so the operator views are reviewable
 * before a vault exists. Every figure below is invented and the UI says so on
 * every screen — see the banner in src/app/desk/page.tsx. Swap in the RPC
 * adapter by setting NEXT_PUBLIC_VAULT_ADDRESS and NEXT_PUBLIC_RPC_URL.
 */

const USDG = { address: "0x0000000000000000000000000000000000000000", symbol: "USDG", decimals: 6 };
const M = 10n ** 6n;

export class FixtureAdapter implements DeskAdapter {
  readonly isFixture = true;

  async snapshot(): Promise<DeskSnapshot> {
    const realized = 48_213_400_000n; // 48,213.40
    const holderAccrued = (realized * 1500n) / 10000n;
    const distributed = 5_900_000_000n;

    return {
      readAt: new Date().toISOString(),
      isFixture: true,
      chain: null,
      vault: {
        address: "0x0000000000000000000000000000000000000000",
        owner: "0x0000000000000000000000000000000000000000",
        keeper: "0x0000000000000000000000000000000000000000",
        venues: [
          "0x0000000000000000000000000000000000000000",
          "0x0000000000000000000000000000000000000000",
        ],
        payoutAsset: USDG,
      },
      ledger: {
        realized,
        workingCapital: realized - holderAccrued,
        distributed,
        owed: holderAccrued - distributed,
        cash: 12_450_000_000n,
        rateLimitRemaining: 740_000n * M,
      },
      positions: [
        { symbol: "AMC", instrument: "AMC Entertainment", quantity: 412n * 10n ** 18n, decimals: 18, basis: 3_120_000n, reference: 3_040_000n, mark: 3_960_000n },
        { symbol: "GME", instrument: "GameStop", quantity: 88n * 10n ** 18n, decimals: 18, basis: 22_400_000n, reference: 22_910_000n, mark: 23_050_000n },
        { symbol: "BBBY", instrument: "Bed Bath & Beyond", quantity: 1_940n * 10n ** 18n, decimals: 18, basis: 214_000n, reference: 208_000n, mark: 331_000n },
        { symbol: "NOK", instrument: "Nokia", quantity: 260n * 10n ** 18n, decimals: 18, basis: 4_410_000n, reference: 4_460_000n, mark: 4_452_000n },
      ],
      bands: [
        { pool: "0x1a2b3c4d5e6f70819a2b3c4d5e6f7081", symbol: "BBBY", instrument: "Bed Bath & Beyond", quote: "USDG", feeTier: 3000, lower: 396_000n, upper: 444_000n, price: 421_000n, capital: 9_800_000_000n, feesEarned: 412_900_000n, inRange: true, openedAt: new Date(Date.now() - 31 * 3_600_000).toISOString() },
        { pool: "0x2b3c4d5e6f70819a2b3c4d5e6f708192", symbol: "EXPR", instrument: "Express", quote: "USDG", feeTier: 3000, lower: 1_094_000n, upper: 1_226_000n, price: 1_161_000n, capital: 7_400_000_000n, feesEarned: 268_400_000n, inRange: true, openedAt: new Date(Date.now() - 19 * 3_600_000).toISOString() },
        { pool: "0x3c4d5e6f70819a2b3c4d5e6f70819a2b", symbol: "AMC", instrument: "AMC Entertainment", quote: "USDG", feeTier: 500, lower: 2_910_000n, upper: 3_210_000n, price: 3_052_000n, capital: 11_200_000_000n, feesEarned: 331_700_000n, inRange: true, openedAt: new Date(Date.now() - 52 * 3_600_000).toISOString() },
        { pool: "0x4d5e6f70819a2b3c4d5e6f70819a2b3c", symbol: "KOSS", instrument: "Koss Corporation", quote: "USDG", feeTier: 3000, lower: 8_120_000n, upper: 9_040_000n, price: 9_310_000n, capital: 4_600_000_000n, feesEarned: 96_200_000n, inRange: false, openedAt: new Date(Date.now() - 7 * 3_600_000).toISOString() },
      ],
      dislocations: [
        { pool: "0x0000000000000000000000000000000000000000", symbol: "BBBY", deviation: 0.591, probeYield: 41_200_000n, depth: 1_180_000n, qualifies: true, blockedBy: null },
        { pool: "0x0000000000000000000000000000000000000000", symbol: "AMC", deviation: 0.303, probeYield: 28_900_000n, depth: 402_000n, qualifies: true, blockedBy: null },
        { pool: "0x0000000000000000000000000000000000000000", symbol: "KOSS", deviation: 4.12, probeYield: null, depth: 0n, qualifies: false, blockedBy: "probe returned nothing — mirage" },
        { pool: "0x0000000000000000000000000000000000000000", symbol: "GME", deviation: 0.061, probeYield: 19_400_000n, depth: 890_000n, qualifies: false, blockedBy: "below δ* (+25%)" },
        { pool: "0x0000000000000000000000000000000000000000", symbol: "EXPR", deviation: 0.412, probeYield: 26_100_000n, depth: 41_000n, qualifies: false, blockedBy: "depth under $100 above floor" },
      ],
      distributions: [
        { at: new Date(Date.now() - 4 * 60_000).toISOString(), total: 1_284_000_000n, recipients: 612, txHash: "0x" + "0".repeat(64) },
        { at: new Date(Date.now() - 19 * 60_000).toISOString(), total: 962_000_000n, recipients: 610, txHash: "0x" + "0".repeat(64) },
        { at: new Date(Date.now() - 34 * 60_000).toISOString(), total: 1_517_000_000n, recipients: 607, txHash: "0x" + "0".repeat(64) },
        { at: new Date(Date.now() - 49 * 60_000).toISOString(), total: 803_000_000n, recipients: 603, txHash: "0x" + "0".repeat(64) },
      ],
      eligible: [
        { symbol: "BBBY", impact1k: 0.0184, impact10k: 0.114, classification: "eligible", reason: "$1k moves price 1.84%" },
        { symbol: "AMC", impact1k: 0.0091, impact10k: 0.062, classification: "eligible", reason: "$1k moves price 0.91%" },
        { symbol: "EXPR", impact1k: 0.0233, impact10k: 0.161, classification: "eligible", reason: "$1k moves price 2.33%" },
        { symbol: "GME", impact1k: 0.0012, impact10k: 0.0021, classification: "deep", reason: "$10k moves price 0.21% — arbitraged before inventory monetizes" },
        { symbol: "NVDA", impact1k: 0.0004, impact10k: 0.0009, classification: "deep", reason: "$10k moves price 0.09%" },
        { symbol: "SPY", impact1k: 0.0002, impact10k: 0.0006, classification: "excluded", reason: "tokenized ETF — excluded categorically" },
      ],
    };
  }
}
