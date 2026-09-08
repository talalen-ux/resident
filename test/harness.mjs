/**
 * A local EVM test harness.
 *
 * Hardhat and Foundry both insist on downloading a compiler from a host this
 * environment's egress policy blocks, so this compiles with the npm-installed
 * solc and executes against @ethereumjs/vm. Real EVM semantics, no network.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createVM, runTx } from "@ethereumjs/vm";
import { Common, Mainnet, Hardfork } from "@ethereumjs/common";
import { createLegacyTx } from "@ethereumjs/tx";
import { createBlock } from "@ethereumjs/block";
import {
  createAccount,
  createAddressFromPrivateKey,
  createAddressFromString,
  hexToBytes,
  bytesToHex,
} from "@ethereumjs/util";
import solc from "solc";
import {
  AbiCoder,
  Interface,
  keccak256 as ethersKeccak,
  toUtf8Bytes,
} from "ethers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const abiCoder = AbiCoder.defaultAbiCoder();

/** Compile every .sol under contracts/ in one pass. */
export function compile() {
  const sources = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith(".sol")) {
        sources[p.slice(ROOT.length + 1)] = { content: readFileSync(p, "utf8") };
      }
    }
  };
  walk(join(ROOT, "contracts"));

  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // Pinned rather than left to solc's default, which is newer than the
          // harness VM. Match this to the target chain before deploying.
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );

  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) {
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  }

  const artifacts = {};
  for (const file of Object.keys(out.contracts ?? {})) {
    for (const [name, c] of Object.entries(out.contracts[file])) {
      artifacts[name] = { abi: c.abi, bytecode: c.evm.bytecode.object };
    }
  }
  return { artifacts, warnings: (out.errors ?? []).filter((e) => e.severity !== "error") };
}

const KEY = (n) => hexToBytes("0x" + String(n).padStart(2, "0").repeat(32));

export class Chain {
  constructor(vm, artifacts) {
    this.vm = vm;
    this.artifacts = artifacts;
    this.nonces = new Map();
  }

  static async create(artifacts, accountCount = 6) {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Shanghai });
    const vm = await createVM({ common });
    const chain = new Chain(vm, artifacts);
    chain.common = common;

    chain.now = 1_800_000_000n; // fixed epoch so tests are deterministic
    chain.blockNumber = 1n;
    chain.wallets = [];
    for (let i = 1; i <= accountCount; i++) {
      const pk = KEY(i);
      const address = createAddressFromPrivateKey(pk);
      await vm.stateManager.putAccount(address, createAccount({ balance: 10n ** 22n }));
      chain.wallets.push({ pk, address, hex: address.toString() });
    }
    return chain;
  }

  async #send(wallet, to, data, value = 0n) {
    const nonce = this.nonces.get(wallet.hex) ?? 0n;
    this.nonces.set(wallet.hex, nonce + 1n);
    const tx = createLegacyTx(
      { nonce, to, gasLimit: 12_000_000, gasPrice: 0, value, data },
      { common: this.common },
    ).sign(wallet.pk);
    // Every tx runs in a block carrying the harness clock, so contracts see a
    // timestamp the test controls.
    const block = createBlock(
      {
        header: {
          timestamp: this.now,
          gasLimit: 30_000_000,
          number: this.blockNumber++,
          baseFeePerGas: 0n,
        },
      },
      { common: this.common },
    );
    return runTx(this.vm, {
      tx,
      block,
      skipBlockGasLimitValidation: true,
      skipBalance: true,
      skipNonce: false,
    });
  }

  /** Deploy by contract name. Returns { address, iface }. */
  async deploy(name, args = [], wallet = this.wallets[0]) {
    const art = this.artifacts[name];
    if (!art) throw new Error(`no artifact for ${name}`);
    const iface = new Interface(art.abi);
    const ctor = art.abi.find((f) => f.type === "constructor");
    const encoded = ctor
      ? abiCoder.encode(ctor.inputs.map((i) => i.type), args).slice(2)
      : "";
    const res = await this.#send(wallet, undefined, hexToBytes("0x" + art.bytecode + encoded));
    if (res.execResult.exceptionError) {
      throw new Error(`deploy ${name} failed: ${res.execResult.exceptionError.error}`);
    }
    return { address: res.createdAddress, hex: res.createdAddress.toString(), iface, name };
  }

  /** Send a state-changing call. Resolves { ok, error, logs, returned }. */
  async call(contract, method, args = [], { from = this.wallets[0], value = 0n } = {}) {
    const data = hexToBytes(contract.iface.encodeFunctionData(method, args));
    const res = await this.#send(from, contract.address, data, value);
    const err = res.execResult.exceptionError;
    const returned = bytesToHex(res.execResult.returnValue);
    return {
      ok: !err,
      error: err ? this.#decodeRevert(contract, returned, err) : null,
      logs: res.execResult.logs ?? [],
      returned,
      gas: res.totalGasSpent,
    };
  }

  /** Read-only call. Returns the decoded result. */
  async read(contract, method, args = []) {
    const res = await this.call(contract, method, args, { from: this.wallets[5] });
    if (!res.ok) throw new Error(`read ${method} reverted: ${res.error}`);
    const decoded = contract.iface.decodeFunctionResult(method, res.returned);
    return decoded.length === 1 ? decoded[0] : decoded;
  }

  #decodeRevert(contract, returned, err) {
    if (!returned || returned === "0x") return err.error;
    try {
      const parsed = contract.iface.parseError(returned);
      if (parsed) return parsed.name;
    } catch {}
    // Error(string)
    if (returned.startsWith("0x08c379a0")) {
      try {
        return abiCoder.decode(["string"], "0x" + returned.slice(10))[0];
      } catch {}
    }
    return err.error;
  }

  /** Advance the clock contracts see, for testing time-dependent logic. */
  warp(seconds) {
    this.now += BigInt(seconds);
    return this.now;
  }
}

export const selector = (sig) => ethersKeccak(toUtf8Bytes(sig)).slice(0, 10);
export { createAddressFromString };
