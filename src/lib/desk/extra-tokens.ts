/**
 * Tokens the operator has allowed beyond the canonical registry.
 *
 * The registry in tokens.ts answers one question — is this the canonical
 * Robinhood Stock Token for its underlying — and answers it well. It is the
 * wrong question for a desk whose job is to be where the volume is. On
 * Robinhood Chain the volume is in tokens that registry has never heard of,
 * and a board that cannot see them is a board that cannot rank them.
 *
 * So this is a second tier, and the two are deliberately not merged:
 *
 *   canonical  identity is verified by the chain's own documentation
 *   extra      identity is the operator's assertion, and nothing more
 *
 * Which means the extra tier is gated harder, not equally. A canonical token
 * cannot be a honeypot with a transfer tax; an extra one can be anything the
 * operator pasted. Age, depth and hook floors exist for that tier because the
 * thing they stand in for — someone having checked — is absent.
 *
 * Symbols and decimals are read off the chain rather than configured. The
 * registry's own comment explains why: guessing 18 decimals for an unknown
 * token silently mis-scales every figure downstream, and a mis-scaled figure
 * does not look wrong, it looks profitable.
 */

import type { TokenMeta } from "../sim/v3.ts";

/** ERC-20 reads, derived from their signatures. */
export const ERC20_SELECTORS = {
  /** symbol() */
  symbol: "0x95d89b41",
  /** decimals() */
  decimals: "0x313ce567",
} as const;

export type Call = (to: string, data: string) => Promise<string>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parse the operator's list.
 *
 * Refuses anything that is not an address rather than skipping it. A typo in
 * this variable is a token the desk silently will not trade, which looks
 * exactly like a token that never had any volume.
 */
export function parseExtraTokens(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!ADDRESS.test(entry)) {
      throw new Error(
        `RESIDENT_EXTRA_TOKENS contains "${entry}", which is not an address. ` +
          "Comma-separated 0x… addresses only; symbols and decimals are read " +
          "from the chain.",
      );
    }
    const lower = entry.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

/** Decode an ERC-20 string return, tolerating the bytes32 form older tokens use. */
export function decodeSymbol(result: string): string | null {
  const body = result?.replace(/^0x/, "") ?? "";
  if (!body) return null;

  // The ABI-encoded string form: offset, length, then the bytes.
  if (body.length >= 128) {
    try {
      const length = Number(BigInt(`0x${body.slice(64, 128)}`));
      if (length > 0 && length <= 32 && body.length >= 128 + length * 2) {
        const text = Buffer.from(body.slice(128, 128 + length * 2), "hex").toString("utf8");
        if (/^[\x20-\x7e]+$/.test(text)) return text;
      }
    } catch {
      // fall through to the bytes32 reading
    }
  }

  // The bytes32 form: a single word, right-padded with zeros.
  if (body.length === 64) {
    const text = Buffer.from(body, "hex").toString("utf8").replace(/\0+$/, "");
    if (text && /^[\x20-\x7e]+$/.test(text)) return text;
  }

  return null;
}

/**
 * Read one token's symbol and decimals off the chain.
 *
 * Throws rather than defaulting. An address that does not answer these is not
 * an ERC-20 the desk can price, and treating it as one produces a board entry
 * whose every number is wrong by a power of ten.
 */
export async function resolveToken(call: Call, address: string): Promise<TokenMeta> {
  const [symbolRaw, decimalsRaw] = await Promise.all([
    call(address, ERC20_SELECTORS.symbol),
    call(address, ERC20_SELECTORS.decimals),
  ]);

  const symbol = decodeSymbol(symbolRaw);
  if (!symbol) {
    throw new Error(`${address}: symbol() did not answer, so this is not a token the desk can price`);
  }

  const decimals = decimalsRaw && decimalsRaw !== "0x" ? Number(BigInt(decimalsRaw)) : NaN;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`${address}: decimals() returned ${decimalsRaw}, which cannot be a token's decimals`);
  }

  return { symbol, decimals, address };
}

export type ExtraRegistry = Map<string, TokenMeta>;

/**
 * Resolve every allowed address, reporting the ones that could not be read
 * rather than failing the whole list.
 *
 * One unreadable address should not cost the desk the other nine. It is still
 * named, because an address that was meant to be trading and is not is a
 * question the operator needs put to them rather than answered by silence.
 */
export async function resolveExtraTokens(
  call: Call,
  addresses: string[],
): Promise<{ registry: ExtraRegistry; failed: { address: string; reason: string }[] }> {
  const registry: ExtraRegistry = new Map();
  const failed: { address: string; reason: string }[] = [];

  for (const address of addresses) {
    try {
      registry.set(address.toLowerCase(), await resolveToken(call, address));
    } catch (error) {
      failed.push({
        address,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { registry, failed };
}

export type ExtraGates = {
  /** Minutes a pool must have existed. A launch is not an LP candidate. */
  minAgeMinutes: number;
  /** In-band depth, in dollars, below which the position becomes the book. */
  minLiquidityUsd: number;
  /** Refuse pools running a v4 hook, which can take the LP's fee. */
  rejectHooks: boolean;
};

/**
 * Deliberately stricter than anything applied to the canonical tier.
 *
 * A day of age is the cheapest filter that removes the entire class the
 * screener rewards most: a pool hours old showing five figures of percentage
 * change, where the volume is real and the price it was traded at is not
 * something a range could have been quoted around.
 */
export const DEFAULT_EXTRA_GATES: ExtraGates = {
  minAgeMinutes: 1_440,
  minLiquidityUsd: 250_000,
  rejectHooks: true,
};

export type GateVerdict = { ok: true } | { ok: false; reason: string };

/** Apply the extra tier's floors to one observed pool. */
export function checkExtraGates(
  pool: { ageMinutes: number; hasHook: boolean; liquidityUsd: number },
  gates: ExtraGates = DEFAULT_EXTRA_GATES,
): GateVerdict {
  if (pool.ageMinutes < gates.minAgeMinutes) {
    const hours = (pool.ageMinutes / 60).toFixed(1);
    return {
      ok: false,
      reason: `${hours}h old, under the ${(gates.minAgeMinutes / 60).toFixed(0)}h floor for non-canonical tokens`,
    };
  }
  if (gates.rejectHooks && pool.hasHook) {
    return { ok: false, reason: "runs a v4 hook, which can take the LP's fee" };
  }
  if (!(pool.liquidityUsd >= gates.minLiquidityUsd)) {
    return {
      ok: false,
      reason:
        `${Math.round(pool.liquidityUsd).toLocaleString()} in band, under the ` +
        `${gates.minLiquidityUsd.toLocaleString()} floor`,
    };
  }
  return { ok: true };
}

/** Read the tier's floors from the environment, falling back to the defaults. */
export function gatesFrom(env: NodeJS.ProcessEnv = process.env): ExtraGates {
  const num = (key: string, fallback: number) => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${key} is "${raw}", which is not a number the gate can use`);
    }
    return value;
  };
  return {
    minAgeMinutes: num("RESIDENT_EXTRA_MIN_AGE_MINUTES", DEFAULT_EXTRA_GATES.minAgeMinutes),
    minLiquidityUsd: num("RESIDENT_EXTRA_MIN_LIQUIDITY", DEFAULT_EXTRA_GATES.minLiquidityUsd),
    rejectHooks: env.RESIDENT_EXTRA_ALLOW_HOOKS === "1" ? false : DEFAULT_EXTRA_GATES.rejectHooks,
  };
}
