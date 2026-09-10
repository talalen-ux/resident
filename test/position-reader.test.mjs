/**
 * Reading the desk's own book off the chain.
 *
 * Two kinds of assertion here. The selector and bit-layout tests are against
 * @uniswap/v4-periphery's own signatures, so an upstream rename breaks the
 * build rather than silently returning zero. The arithmetic tests are about
 * numbers that look plausible when they are wrong, which is the dangerous kind.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { id, keccak256, solidityPacked } from "ethers";

import {
  POSITION_SELECTORS,
  feesOwed,
  priceAtTick,
  readPosition,
  toInt24,
  unpackPositionInfo,
  valueOf,
  word,
} from "../src/lib/keeper/position-reader.ts";

test("every selector is the first four bytes of the signature it claims", () => {
  const signatures = {
    getPoolAndPositionInfo: "getPoolAndPositionInfo(uint256)",
    getPositionLiquidity: "getPositionLiquidity(uint256)",
    getPositionInfo: "getPositionInfo(bytes32,bytes32)",
    getFeeGrowthInside: "getFeeGrowthInside(bytes32,int24,int24)",
    balanceOf: "balanceOf(address)",
  };
  for (const [name, signature] of Object.entries(signatures)) {
    assert.equal(
      POSITION_SELECTORS[name],
      id(signature).slice(0, 10),
      `${name} does not match ${signature}`,
    );
  }
});

test("a 24-bit tick sign-extends, so negative ranges are not read as huge positive ones", () => {
  assert.equal(toInt24(0n), 0);
  assert.equal(toInt24(60n), 60);
  assert.equal(toInt24(0x7fffffn), 8388607);
  // -60 as 24-bit two's complement. Read unsigned this is 16777156, which as a
  // tick is past MAX_TICK and would price the position at infinity.
  assert.equal(toInt24(0xffffc4n), -60);
  assert.equal(toInt24(0x800000n), -8388608);
});

test("PositionInfo unpacks at the offsets the library declares", () => {
  // 200 bits poolId | 24 tickUpper | 24 tickLower | 8 hasSubscriber
  const tickLower = -887220;
  const tickUpper = 887220;
  const info =
    (0xabcdn << 56n) |
    (BigInt.asUintN(24, BigInt(tickUpper)) << 32n) |
    (BigInt.asUintN(24, BigInt(tickLower)) << 8n) |
    1n;

  const unpacked = unpackPositionInfo(info);
  assert.equal(unpacked.tickLower, tickLower);
  assert.equal(unpacked.tickUpper, tickUpper);
  assert.equal(unpacked.hasSubscriber, true);
});

test("fee growth subtraction wraps, because the counters do", () => {
  const liquidity = 1000n;
  const Q128 = 1n << 128n;

  // An ordinary reading.
  assert.equal(feesOwed(5n * Q128, 2n * Q128, liquidity), 3n * liquidity);

  // The counter has wrapped past 2^256 since the position was last touched.
  // Read as plain integers this is a negative delta, and as unsigned it is
  // astronomically positive; the correct answer is the small real one.
  const max = (1n << 256n) - 1n;
  const last = max - Q128;
  const now = Q128; // wrapped around
  assert.equal(feesOwed(now, last, liquidity), 2n * liquidity + 0n);
});

test("no fee has accrued when nothing has moved", () => {
  assert.equal(feesOwed(12345n, 12345n, 999999n), 0n);
});

test("price at a tick accounts for the decimals of both sides", () => {
  // USDG has 6 decimals, a token 18. At tick 0 the raw ratio is 1, and the
  // human price is 10^(18-6) = 1e12 of the quote per unit of the base.
  assert.equal(priceAtTick(0, 18, 6), 1e12);
  assert.equal(priceAtTick(0, 6, 6), 1);
  // One tick is one basis point.
  assert.ok(Math.abs(priceAtTick(1, 6, 6) - 1.0001) < 1e-12);
});

test("a position with no liquidity is worth nothing rather than NaN", () => {
  const value = valueOf(
    { liquidity: 0n, tickLower: -60, tickUpper: 60 },
    1,
    6,
    6,
  );
  assert.equal(value, 0);
});

test("a position in range holds both sides and is worth about its capital", () => {
  // A band of +/- 1% around a price of 1, funded so that L is 1e6 whole units.
  const position = { liquidity: 10n ** 12n, tickLower: -100, tickUpper: 100 };
  const value = valueOf(position, 1, 6, 6);
  // L * (2*sqrt(p) - sqrt(pa) - p/sqrt(pb)) at p=1 with a ~1% band.
  const pa = priceAtTick(-100, 6, 6);
  const pb = priceAtTick(100, 6, 6);
  const expected = 1e6 * (2 - Math.sqrt(pa) - 1 / Math.sqrt(pb));
  assert.ok(
    Math.abs(value - expected) / expected < 1e-9,
    `${value} should match the hand-computed ${expected}`,
  );
});

test("readPosition asks for the right things and joins them correctly", async () => {
  const PM = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
  const SV = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
  const tickLower = -60;
  const tickUpper = 60;
  const Q128 = 1n << 128n;

  const hex = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, "0");
  const info =
    (0xabcdn << 56n) |
    (BigInt.asUintN(24, BigInt(tickUpper)) << 32n) |
    (BigInt.asUintN(24, BigInt(tickLower)) << 8n);

  const asked = [];
  const call = async (to, data) => {
    asked.push({ to, selector: data.slice(0, 10), data });
    if (data.startsWith(POSITION_SELECTORS.getPoolAndPositionInfo)) {
      return (
        "0x" +
        hex("0x1111111111111111111111111111111111111111") +
        hex("0x2222222222222222222222222222222222222222") +
        hex(3000) +
        hex(60) +
        hex(0) +
        hex(info)
      );
    }
    if (data.startsWith(POSITION_SELECTORS.getPositionLiquidity)) return "0x" + hex(5000);
    if (data.startsWith(POSITION_SELECTORS.getPositionInfo)) {
      return "0x" + hex(5000) + hex(2n * Q128) + hex(7n * Q128);
    }
    if (data.startsWith(POSITION_SELECTORS.getFeeGrowthInside)) {
      return "0x" + hex(5n * Q128) + hex(9n * Q128);
    }
    throw new Error(`unexpected call ${data.slice(0, 10)}`);
  };

  const result = await readPosition(
    {
      call,
      positionManager: PM,
      stateView: SV,
      poolIdOf: () => "0x" + "ab".repeat(32),
      keccakPacked: (owner, lower, upper, salt) =>
        keccak256(
          solidityPacked(["address", "int24", "int24", "bytes32"], [owner, lower, upper, salt]),
        ),
    },
    "42",
  );

  assert.equal(result.tickLower, tickLower);
  assert.equal(result.tickUpper, tickUpper);
  assert.equal(result.liquidity, 5000n);
  assert.equal(result.fee, 3000);
  assert.equal(result.tickSpacing, 60);
  assert.equal(result.currency0, "0x1111111111111111111111111111111111111111");
  // (5 - 2) * 5000 and (9 - 7) * 5000.
  assert.equal(result.fees0, 3n * 5000n);
  assert.equal(result.fees1, 2n * 5000n);

  // The bounds must go to the pool as the SAME ticks the position reports.
  // Asking getFeeGrowthInside for a different range returns a real number for
  // the wrong range, which is the failure this checks for.
  const growthCall = asked.find((a) =>
    a.selector === POSITION_SELECTORS.getFeeGrowthInside,
  );
  assert.ok(growthCall.data.includes(hex(tickLower)), "lower tick not in the call");
  assert.ok(growthCall.data.includes(hex(tickUpper)), "upper tick not in the call");
  assert.equal(growthCall.to, SV);
});

test("word reads the nth 32-byte slot", () => {
  const hex = "0x" + "11".repeat(32) + "22".repeat(32);
  assert.equal(word(hex, 0), "11".repeat(32));
  assert.equal(word(hex, 1), "22".repeat(32));
});
