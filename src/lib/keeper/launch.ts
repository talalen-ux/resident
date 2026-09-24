/**
 * The launch record, and where its fees point.
 *
 * Everything downstream of the launch assumes one fact: the vault is the
 * launch's creator fee recipient. If it is not, the desk runs correctly and
 * earns nothing, because the fees it exists to compound are being paid to
 * somebody else. That is a silent failure — no revert, no error, just an
 * inflow of zero that looks exactly like a quiet market.
 *
 * So it is read, not assumed. The launch factory keeps a record per token and
 * exposes it as `getLaunchedToken(address)`, which includes the recipient.
 *
 * The recipient is also changeable, which matters for the order of operations.
 * From the factory:
 *
 *   - `transferCreatorFeeRecipient(token, newRecipient)` is callable by the
 *     current recipient, takes effect immediately, and is explicitly exempt
 *     from the factory's timelock ("never subject to this delay").
 *   - `setCreatorFeeRecipient` is the protocol owner's path and IS delayed,
 *     through propose/execute. That one is not ours.
 *
 * The consequence: launching with your own wallet as the recipient and moving
 * it to the vault afterwards costs one transaction and no waiting. The vault
 * does not have to exist before the launch. It is still better if it does,
 * because a launch whose fees point at a wallet is a launch that is only ever
 * one forgotten step away from paying the wrong address for good.
 */

import { word } from "./position-reader.ts";
import type { UnsignedCall } from "./signer.ts";

/**
 * test/launch.test.mjs re-derives both from their signatures, so a drift breaks the build rather
 * than sending a call nothing answers.
 */
export const LAUNCH_SELECTORS = {
  /** getLaunchedToken(address) */
  getLaunchedToken: "0x3cf28b5a",
  /** transferCreatorFeeRecipient(address,address) */
  transferCreatorFeeRecipient: "0x2931861b",
} as const;

/** GraduationPhase, in declaration order. */
export const GRADUATION_PHASES = [
  "not graduated",
  "swept",
  "pool created",
  "rescued",
] as const;

export type GraduationPhase = (typeof GRADUATION_PHASES)[number];

export type LaunchRecord = {
  token: string;
  /** The bonding curve. Zero once the launch has graduated into a v4 pool. */
  curve: string;
  deployer: string;
  /** Who the trading fees are paid to. The whole point of reading this. */
  creatorFeeRecipient: string;
  /** The quote asset the curve raises in, and the pool graduates against. */
  pairToken: string;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  /** An extra trade fee paid to the creator in full, chosen at launch. */
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: GraduationPhase;
  /** False for a token this factory never launched. Check it first. */
  exists: boolean;
};

export type Call = (to: string, data: string) => Promise<string>;

const pad = (value: string) =>
  value.replace(/^0x/, "").toLowerCase().padStart(64, "0");

const addressAt = (data: string, index: number) =>
  `0x${word(data, index).slice(24)}`;

const uintAt = (data: string, index: number) => BigInt(`0x${word(data, index)}`);

/** A 24-bit two's-complement tickSpacing, widened out of its word. */
const int24At = (data: string, index: number) => {
  const masked = uintAt(data, index) & 0xffffffn;
  return Number(masked >= 0x800000n ? masked - 0x1000000n : masked);
};

/**
 * Decode the struct the factory returns.
 *
 * Every member is a static type, so the struct is encoded in place with no
 * head offset and each field is its own word, in declaration order. Fifteen
 * words. test/launch.test.mjs encodes a record with ethers and decodes it with
 * this, which is what pins the offsets to the source rather than to a comment.
 */
export function decodeLaunch(data: string): LaunchRecord {
  const body = data.replace(/^0x/, "");
  if (body.length < 15 * 64) {
    throw new Error(
      `launch record is ${body.length / 2} bytes, expected at least 480 — ` +
        "wrong factory address, or a token this factory never launched",
    );
  }
  const hex = `0x${body}`;
  const phase = Number(uintAt(hex, 10));
  return {
    token: addressAt(hex, 0),
    curve: addressAt(hex, 1),
    deployer: addressAt(hex, 2),
    creatorFeeRecipient: addressAt(hex, 3),
    pairToken: addressAt(hex, 4),
    graduationThreshold: uintAt(hex, 5),
    poolFee: Number(uintAt(hex, 6)),
    tickSpacing: int24At(hex, 7),
    creatorTaxBps: Number(uintAt(hex, 8)),
    buybackEnabled: uintAt(hex, 9) !== 0n,
    phase: GRADUATION_PHASES[phase] ?? `unknown (${phase})` as GraduationPhase,
    exists: uintAt(hex, 14) !== 0n,
  };
}

/** Read the launch record for a token off the factory. */
export async function launchOf(
  call: Call,
  factory: string,
  token: string,
): Promise<LaunchRecord> {
  const data = `${LAUNCH_SELECTORS.getLaunchedToken}${pad(token)}`;
  return decodeLaunch(await call(factory, data));
}

/**
 * True when this launch's fees are paid to the vault.
 *
 * Case-insensitive: the factory returns lowercase words, a configured address
 * is usually checksummed, and comparing them raw is a check that reports a
 * correct setup as broken.
 */
export function feesPointAt(record: LaunchRecord, vault: string): boolean {
  return record.creatorFeeRecipient.toLowerCase() === vault.toLowerCase();
}

/**
 * The call that points a launch's fees at the vault.
 *
 * It must be sent by the CURRENT recipient — at launch, the wallet that
 * launched. Not the vault owner, unless they happen to be the same wallet, and
 * never the keeper. So this is calldata to sign by hand, like every other
 * owner action in this repository, rather than something the keeper submits.
 *
 * It is one way. Once the vault holds the stream, moving it again means
 * calling this from the vault, which the vault has no function to do.
 */
export function pointFeesCall(
  factory: string,
  token: string,
  vault: string,
): UnsignedCall {
  if (!/^0x[0-9a-fA-F]{40}$/.test(vault) || /^0x0{40}$/.test(vault)) {
    throw new Error(`refusing to point launch fees at ${vault}`);
  }
  return {
    to: factory,
    data: `${LAUNCH_SELECTORS.transferCreatorFeeRecipient}${pad(token)}${pad(vault)}`,
    description: `point ${token} creator fees at ${vault}`,
  };
}
