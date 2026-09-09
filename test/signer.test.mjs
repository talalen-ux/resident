/**
 * The keeper's own key, and the guardrails that make holding one acceptable.
 *
 * The assertions here are almost all about refusing. A signer that will sign
 * anything for anyone is not a component, it is the absence of one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Transaction, Wallet } from "ethers";

import {
  KeyRejected,
  addressOf,
  guardChain,
  localSigner,
  signEip1559,
} from "../src/lib/keeper/signer-local.ts";
import { MAINNET, TESTNET } from "../src/lib/chain.ts";
import { checkSigner } from "../src/lib/keeper/signer.ts";

const KEY = "0x" + "11".repeat(32);
const ADDRESS = new Wallet(KEY).address;

const node = (chainId, over = {}) => async (method) => {
  const answers = {
    eth_chainId: "0x" + chainId.toString(16),
    eth_getTransactionCount: "0x1",
    eth_getBlockByNumber: { baseFeePerGas: "0x" + (10n ** 9n).toString(16) },
    eth_maxPriorityFeePerGas: "0x" + (10n ** 9n).toString(16),
    eth_estimateGas: "0x" + (100_000).toString(16),
    eth_sendRawTransaction: "0xdeadbeef",
    ...over,
  };
  return answers[method];
};

const call = { to: "0x" + "22".repeat(20), data: "0x1234", description: "test" };

/* ------------------------------------------------------------ the key itself */

test("a missing key is refused with a way forward, not a stack trace", () => {
  assert.throws(() => localSigner({ rpc: node(TESTNET.chainId), key: "" }), (e) => {
    assert.ok(e instanceof KeyRejected);
    assert.match(e.message, /dry run/);
    return true;
  });
});

/**
 * ethers' own error for a bad key includes the value it was given, and that
 * value ends up in a log. The shape is checked before a Wallet is built.
 */
test("a malformed key is refused without echoing it", () => {
  for (const bad of ["nonsense", "0x1234", "11".repeat(32)]) {
    assert.throws(() => localSigner({ rpc: node(TESTNET.chainId), key: bad }), (e) => {
      assert.ok(e instanceof KeyRejected, bad);
      assert.ok(!e.message.includes(bad), "the key must not appear in the message");
      assert.match(e.message, /not echoed|not 32 bytes/);
      return true;
    });
  }
});

test("addressOf shows what a key is without printing what it holds", () => {
  assert.equal(addressOf(KEY), ADDRESS);
  assert.throws(() => addressOf("0xshort"), /not echoed/);
});

test("the signer describes itself by address, never by key", () => {
  const signer = localSigner({ rpc: node(TESTNET.chainId), key: KEY });
  assert.equal(signer.description, `local key ${ADDRESS}`);
  assert.ok(!signer.description.includes("11".repeat(32)));
  assert.equal(signer.dryRun, false);
});

/* ------------------------------------------------------------- which chain */

test("mainnet is refused unless it was asked for", () => {
  assert.throws(
    () => guardChain(MAINNET.chainId, { rpc: node(1), key: KEY }),
    (e) => {
      assert.match(e.message, /RESIDENT_ALLOW_MAINNET/);
      return true;
    },
  );
  assert.doesNotThrow(() =>
    guardChain(MAINNET.chainId, { rpc: node(1), key: KEY, allowMainnet: true }),
  );
  assert.doesNotThrow(() => guardChain(TESTNET.chainId, { rpc: node(1), key: KEY }));
});

test("a signer pinned to one chain refuses another", () => {
  assert.throws(
    () =>
      guardChain(TESTNET.chainId, {
        rpc: node(1), key: KEY, expectedChainId: 999,
      }),
    /reports chain 46630.*configured for 999/s,
  );
});

/**
 * The reason this is per transaction rather than once at startup: an RPC URL is
 * an environment variable, and a keeper that follows its RPC onto mainnet is
 * the failure being prevented.
 */
test("the chain is read from the node on every signature", async () => {
  const signer = localSigner({ rpc: node(TESTNET.chainId), key: KEY });
  await signer.send(call);

  const wandered = localSigner({ rpc: node(MAINNET.chainId), key: KEY });
  await assert.rejects(wandered.send(call), /mainnet/);
});

/* --------------------------------------------------------------- signatures */

test("what comes out is a signed transaction from this address", async () => {
  const wallet = new Wallet(KEY);
  const raw = await signEip1559(wallet, {
    chainId: TESTNET.chainId, nonce: 7, to: call.to, data: call.data,
    value: 0n, gasLimit: 100_000n,
    maxFeePerGas: 3n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n,
  });
  const parsed = Transaction.from(raw);
  assert.equal(parsed.from, ADDRESS);
  assert.equal(parsed.chainId, BigInt(TESTNET.chainId));
  assert.equal(parsed.nonce, 7);
  assert.equal(parsed.type, 2, "EIP-1559, not a legacy transaction");
  assert.equal(parsed.data, call.data);
});

test("the raw transaction reaches the node and the hash comes back", async () => {
  let sent = null;
  const rpc = async (method, params) => {
    if (method === "eth_sendRawTransaction") { sent = params[0]; return "0xhash"; }
    return node(TESTNET.chainId)(method);
  };
  const { hash } = await localSigner({ rpc, key: KEY }).send(call);
  assert.equal(hash, "0xhash");
  assert.equal(Transaction.from(sent).from, ADDRESS);
});

/* ------------------------------------------------------- the other half of it */

/**
 * The vault's separation is worth nothing if the same address holds both roles,
 * so it is checked against the chain every tick rather than assumed at setup.
 */
test("this key is refused outright if it is the vault owner", () => {
  const asOwner = checkSigner(ADDRESS, { owner: ADDRESS, keeper: ADDRESS });
  assert.equal(asOwner.ok, false);
  assert.ok(asOwner.problems.some((p) => /vault owner/.test(p)));

  const proper = checkSigner(ADDRESS, { owner: "0x" + "99".repeat(20), keeper: ADDRESS });
  assert.equal(proper.ok, true);
});
