/**
 * Where the launch's fees point.
 *
 * The selector assertions are against the signatures in ponsdotdev/ponsfamily
 * contractsV2. The decode assertions go the other way round: ethers encodes a
 * record from the real struct layout and this decodes it, so a field that
 * moved shows up as a wrong value rather than as a comment that drifted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";

import {
  GRADUATION_PHASES,
  LAUNCH_SELECTORS,
  decodeLaunch,
  feesPointAt,
  launchOf,
  pointFeesCall,
} from "../src/lib/keeper/launch.ts";

const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const TOKEN = "0x1111111111111111111111111111111111111111";
const CURVE = "0x2222222222222222222222222222222222222222";
const DEPLOYER = "0x3333333333333333333333333333333333333333";
const VAULT = "0x4444444444444444444444444444444444444444";
const USDG = "0x5555555555555555555555555555555555555555";

/** ILaunchpadV2.LaunchedToken, in declaration order. */
const STRUCT = [
  "tuple(address,address,address,address,address,uint256,uint24,int24,uint16,bool,uint8,uint256,uint256,uint256,bool)",
];

const encode = (over = {}) => {
  const record = {
    token: TOKEN,
    curve: CURVE,
    deployer: DEPLOYER,
    creatorFeeRecipient: VAULT,
    pairToken: USDG,
    graduationThreshold: 12_000_000_000n,
    poolFee: 10_000,
    tickSpacing: 200,
    creatorTaxBps: 100,
    buybackEnabled: true,
    phase: 0,
    sweptQuote: 0n,
    sweptTokens: 0n,
    sweptAt: 0n,
    exists: true,
    ...over,
  };
  return AbiCoder.defaultAbiCoder().encode(STRUCT, [Object.values(record)]);
};

test("both selectors match the signature they claim", () => {
  const signatures = {
    getLaunchedToken: "getLaunchedToken(address)",
    transferCreatorFeeRecipient: "transferCreatorFeeRecipient(address,address)",
  };
  for (const [name, signature] of Object.entries(signatures)) {
    assert.equal(LAUNCH_SELECTORS[name], id(signature).slice(0, 10), name);
  }
});

test("the transfer is the self-service one, not the protocol owner's", () => {
  // setCreatorFeeRecipient is the owner's path and runs behind the factory's
  // timelock. Encoding that one where this was meant sends a call the launch
  // wallet is not allowed to make.
  assert.notEqual(
    LAUNCH_SELECTORS.transferCreatorFeeRecipient,
    id("setCreatorFeeRecipient(address,address)").slice(0, 10),
  );
});

test("a record decodes field for field", () => {
  const record = decodeLaunch(encode());
  assert.equal(record.token, TOKEN);
  assert.equal(record.curve, CURVE);
  assert.equal(record.deployer, DEPLOYER);
  assert.equal(record.creatorFeeRecipient, VAULT);
  assert.equal(record.pairToken, USDG);
  assert.equal(record.graduationThreshold, 12_000_000_000n);
  assert.equal(record.poolFee, 10_000);
  assert.equal(record.tickSpacing, 200);
  assert.equal(record.creatorTaxBps, 100);
  assert.equal(record.buybackEnabled, true);
  assert.equal(record.phase, "not graduated");
  assert.equal(record.exists, true);
});

test("a negative tickSpacing survives the 24-bit word", () => {
  assert.equal(decodeLaunch(encode({ tickSpacing: -60 })).tickSpacing, -60);
});

test("every graduation phase decodes to its name", () => {
  for (const [value, name] of GRADUATION_PHASES.entries()) {
    assert.equal(decodeLaunch(encode({ phase: value })).phase, name);
  }
});

test("a token the factory never launched reads as not existing", () => {
  // The factory returns a zeroed struct rather than reverting, so `exists` is
  // the only thing separating "no such launch" from "a launch paying nobody".
  const empty = AbiCoder.defaultAbiCoder().encode(STRUCT, [
    [
      "0x" + "0".repeat(40), "0x" + "0".repeat(40), "0x" + "0".repeat(40),
      "0x" + "0".repeat(40), "0x" + "0".repeat(40),
      0n, 0, 0, 0, false, 0, 0n, 0n, 0n, false,
    ],
  ]);
  assert.equal(decodeLaunch(empty).exists, false);
});

test("a short answer is named, not silently decoded", () => {
  // The wrong address answers eth_call with 0x. Slicing that would report a
  // launch paying the zero address, which reads as a real misconfiguration.
  assert.throws(() => decodeLaunch("0x"), /wrong factory address/);
});

test("the recipient check ignores checksum case", () => {
  const record = decodeLaunch(encode());
  assert.equal(feesPointAt(record, VAULT.toUpperCase().replace("0X", "0x")), true);
  assert.equal(feesPointAt(record, DEPLOYER), false);
});

test("launchOf asks the factory about the token", async () => {
  let asked;
  const record = await launchOf(
    async (to, data) => { asked = { to, data }; return encode(); },
    FACTORY,
    TOKEN,
  );
  assert.equal(asked.to, FACTORY);
  assert.equal(asked.data, `${LAUNCH_SELECTORS.getLaunchedToken}${TOKEN.slice(2).padStart(64, "0")}`);
  assert.equal(record.creatorFeeRecipient, VAULT);
});

test("the transfer call carries both arguments in order", () => {
  const call = pointFeesCall(FACTORY, TOKEN, VAULT);
  assert.equal(call.to, FACTORY);
  assert.equal(call.data.slice(0, 10), LAUNCH_SELECTORS.transferCreatorFeeRecipient);
  assert.equal(call.data.slice(10, 74), TOKEN.slice(2).padStart(64, "0"));
  assert.equal(call.data.slice(74, 138), VAULT.slice(2).padStart(64, "0"));
});

test("it refuses to point the fee stream at nothing", () => {
  // This transfer has no undo from the vault's side: the vault has no function
  // to call the factory. Pointing it at the zero address burns the inflow the
  // entire design exists to compound.
  assert.throws(() => pointFeesCall(FACTORY, TOKEN, `0x${"0".repeat(40)}`), /refusing/);
  assert.throws(() => pointFeesCall(FACTORY, TOKEN, "not-an-address"), /refusing/);
});
