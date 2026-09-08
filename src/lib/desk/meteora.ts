import type { ScannedPool } from "@/lib/sim/scanner";

/**
 * Meteora DLMM pairs, normalised for the scanner.
 *
 * Field names are mapped tolerantly and required values are checked, because
 * the failure this guards against is silent. A renamed field read as undefined
 * becomes 0, and a pool with zero volume and zero volatility does not error —
 * it prices as free money and sorts to the top of the board. Every required
 * value therefore has to be present and positive or the pair is skipped with a
 * reason, which the scanner surfaces rather than swallows.
 */

const API = "https://dlmm-api.meteora.ag";

/** First present, finite, positive value among the candidate field names. */
function pick(row: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const raw = row[name];
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

export type MeteoraOptions = {
  /** Minimum 24h volume in quote units. */
  minVolume24h?: number;
  /** Cap on TVL: a crowded pool leaves too little of each bin for us. */
  maxLiquidity?: number;
  /**
   * Per-interval volatility by pair address.
   *
   * Meteora's pair list does not carry volatility, and it cannot be guessed:
   * without it a pool has no modelled cost of holding and ranks on fees alone.
   * Supply it from price history, or the pair is skipped.
   */
  volatility?: Record<string, number>;
};

export type MeteoraScan = {
  pools: ScannedPool[];
  skipped: { name: string; reason: string }[];
};

export async function fetchMeteoraPools(
  opts: MeteoraOptions = {},
): Promise<MeteoraScan> {
  const res = await fetch(`${API}/pair/all`);
  if (!res.ok) throw new Error(`Meteora API ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(rows)) throw new Error("Meteora API did not return a list");

  const pools: ScannedPool[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const row of rows) {
    const name = String(row.name ?? row.address ?? "unknown");
    const address = String(row.address ?? name);

    const volume24h = pick(row, ["trade_volume_24h", "volume_24h", "volume24h"]);
    const liquidity = pick(row, ["liquidity", "tvl", "total_liquidity"]);
    const binStep = pick(row, ["bin_step", "binStep"]);
    const feeBps = pick(row, ["base_fee_percentage", "base_fee", "baseFeeBps"]);

    const missing = [
      !volume24h && "24h volume",
      !liquidity && "liquidity",
      !binStep && "bin step",
      !feeBps && "base fee",
    ].filter(Boolean);
    if (missing.length) {
      skipped.push({ name, reason: `missing ${missing.join(", ")}` });
      continue;
    }

    const volatility = opts.volatility?.[address];
    if (!volatility || !(volatility > 0)) {
      skipped.push({ name, reason: "no volatility supplied" });
      continue;
    }

    if (opts.minVolume24h && volume24h! < opts.minVolume24h) continue;
    if (opts.maxLiquidity && liquidity! > opts.maxLiquidity) continue;

    // base_fee_percentage arrives as a percent on this endpoint; the model
    // wants basis points.
    const bps = feeBps! < 1 ? feeBps! * 10_000 : feeBps! * 100;

    // The pair list gives pool TVL, not per-bin depth, and only the active bin
    // earns. Spreading TVL over the bins a position would span is the closest
    // approximation available from this endpoint, and it is an approximation.
    const assumedActiveBins = 20;

    pools.push({
      name,
      chain: "solana",
      kind: "dlmm",
      volume: volume24h! / 1440, // the model is per-minute
      volatility,
      binStep: binStep!,
      feeBps: bps,
      liquidityPerBin: liquidity! / assumedActiveBins,
    });
  }

  return { pools, skipped };
}
