/**
 * Getting a call onto the chain, without ever holding a key.
 *
 * Everything a transaction needs beyond its calldata is read from the node:
 * the nonce, the fee ceiling, the gas limit, the chain id. What this module
 * will not do is sign. It assembles an unsigned transaction and hands it to a
 * `sign` function, which is where a KMS or an HSM goes.
 *
 * That boundary is the point. The vault already enforces that the keeper is not
 * the owner, and the signer check enforces it again every tick; neither is
 * worth anything if the key sits in a file next to the code that uses it.
 */

// Type-only: Signer is an interface, and node's strip-only TypeScript mode does
// not erase a value import of one, so it fails at runtime rather than at build.
import type { SentCall, Signer, UnsignedCall } from "./signer.ts";

export type Eip1559Fields = {
  chainId: number;
  nonce: number;
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/** A minimal JSON-RPC caller. Same shape the pool reader uses. */
export type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;

export function jsonRpc(url: string): Rpc {
  let id = 0;
  return async <T>(method: string, params: unknown[]): Promise<T> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = (await response.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };
}

const big = (hex: string) => BigInt(hex);

export type FeePolicy = {
  /** Multiple of the base fee the transaction is willing to pay. */
  baseFeeMultiple: number;
  /** Multiple of the estimate used as the gas limit. */
  gasLimitMultiple: number;
  /** Refuse to send above this, in wei. A stop, not a target. */
  maxFeeCeiling: bigint;
};

export const DEFAULT_FEES: FeePolicy = {
  baseFeeMultiple: 2,
  gasLimitMultiple: 1.25,
  maxFeeCeiling: 500n * 10n ** 9n, // 500 gwei
};

/**
 * Fill in everything except the signature.
 *
 * The gas limit comes from an estimate against the node rather than a constant,
 * because a mint's cost depends on how many ticks it crosses, and a constant
 * large enough to always work is a constant that hides a revert until it is
 * mined.
 */
export async function assemble(
  rpc: Rpc,
  from: string,
  call: UnsignedCall,
  fees: FeePolicy = DEFAULT_FEES,
): Promise<Eip1559Fields> {
  const tx = { from, to: call.to, data: call.data, value: `0x${(call.value ?? 0n).toString(16)}` };

  const [chainIdHex, nonceHex, block, tipHex, gasHex] = await Promise.all([
    rpc<string>("eth_chainId", []),
    rpc<string>("eth_getTransactionCount", [from, "pending"]),
    rpc<{ baseFeePerGas?: string }>("eth_getBlockByNumber", ["latest", false]),
    rpc<string>("eth_maxPriorityFeePerGas", []).catch(() => "0x3b9aca00"), // 1 gwei
    rpc<string>("eth_estimateGas", [tx]),
  ]);

  const baseFee = block.baseFeePerGas ? big(block.baseFeePerGas) : 0n;
  const tip = big(tipHex);
  const maxFee =
    baseFee * BigInt(Math.max(1, Math.round(fees.baseFeeMultiple))) + tip;

  if (maxFee > fees.maxFeeCeiling) {
    throw new Error(
      `fees are ${maxFee} wei per gas, over the ${fees.maxFeeCeiling} ceiling. ` +
        "Not sending; the position will still be there when gas is cheaper.",
    );
  }

  return {
    chainId: Number(big(chainIdHex)),
    nonce: Number(big(nonceHex)),
    to: call.to,
    data: call.data,
    value: call.value ?? 0n,
    gasLimit:
      (big(gasHex) * BigInt(Math.round(fees.gasLimitMultiple * 100))) / 100n,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: tip,
  };
}

/**
 * A signer that assembles here and signs somewhere else.
 *
 * `sign` takes the assembled fields and returns a raw signed transaction. It is
 * the only place key material is touched, and it is deliberately a function the
 * caller supplies: a KMS client, an HSM session, a remote signing service.
 * Nothing in this repository implements one.
 */
export class RpcSigner implements Signer {
  readonly dryRun = false;
  readonly description: string;
  private readonly rpc: Rpc;
  private readonly from: string;
  private readonly sign: (tx: Eip1559Fields) => Promise<string>;
  private readonly fees: FeePolicy;

  constructor(args: {
    rpc: Rpc;
    from: string;
    sign: (tx: Eip1559Fields) => Promise<string>;
    fees?: FeePolicy;
    description?: string;
  }) {
    this.rpc = args.rpc;
    this.from = args.from;
    this.sign = args.sign;
    this.fees = args.fees ?? DEFAULT_FEES;
    this.description = args.description ?? "external signer";
  }

  async address(): Promise<string> {
    return this.from;
  }

  async send(call: UnsignedCall): Promise<SentCall> {
    const tx = await assemble(this.rpc, this.from, call, this.fees);
    const raw = await this.sign(tx);
    const hash = await this.rpc<string>("eth_sendRawTransaction", [raw]);
    return { hash };
  }
}

/**
 * Wait for a receipt, or give up and say so.
 *
 * Null is returned rather than thrown, and it means "not mined within the time
 * allowed", which the executor turns into Unconfirmed. It does not mean the
 * transaction failed, and nothing downstream may treat it as though it did.
 */
export function receiptWaiter(rpc: Rpc, timeoutMs = 90_000, pollMs = 2_000) {
  return async (hash: string) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const receipt = await rpc<{ status: string; logs: unknown[] } | null>(
        "eth_getTransactionReceipt",
        [hash],
      );
      if (receipt) {
        return {
          ok: big(receipt.status) === 1n,
          logs: receipt.logs as { address: string; topics: string[]; data: string }[],
        };
      }
      if (Date.now() >= until) return null;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };
}
