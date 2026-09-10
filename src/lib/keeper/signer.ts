/**
 * How the keeper signs, and what it refuses to sign with.
 *
 * The vault already enforces that the owner and the keeper are different
 * addresses: the keeper can move capital between venues but cannot change who
 * the venues are, cannot raise the distribution cap, and cannot allowlist a
 * bridge. That separation is worth nothing if the runtime holds the owner key,
 * so the signer is the place it gets enforced a second time.
 *
 * There is no key in this repository and none should ever be pasted into one.
 * The default is {@link DryRunSigner}, which signs nothing: a keeper started
 * without deliberate configuration will read chains, rank pools, journal what
 * it would have done, and touch no money.
 */

export type UnsignedCall = {
  to: string;
  data: string;
  /** Native value in wei. Almost always zero: the vault holds the assets. */
  value?: bigint;
  /** What this call is for, carried into logs and the journal. */
  description: string;
};

export type SentCall = { hash: string };

export interface Signer {
  /** The address calls will come from. */
  address(): Promise<string>;
  /** Submit a call and return its hash, or throw. */
  send(call: UnsignedCall): Promise<SentCall>;
  /** True when this signer cannot actually move anything. */
  readonly dryRun: boolean;
  /** For logs and the status line: how the keeper is authenticated. */
  readonly description: string;
}

/**
 * Signs nothing. Records what it was asked to do and returns a fake hash.
 *
 * The default, and the only signer this repository ships. A dry run is a real
 * mode of operation, not a stub: it is how the loop is proved against a live
 * chain before a key exists, and how it is left running while the numbers are
 * checked against what the pools actually paid.
 */
export class DryRunSigner implements Signer {
  readonly dryRun = true;
  readonly description = "dry run (signs nothing)";
  readonly calls: UnsignedCall[] = [];

  async address(): Promise<string> {
    return "0x0000000000000000000000000000000000000000";
  }

  async send(call: UnsignedCall): Promise<SentCall> {
    this.calls.push(call);
    return { hash: `dryrun:${this.calls.length}` };
  }
}

/** Raised when the node says a call would revert. Carries what it said. */
export class WouldRevert extends Error {
  readonly call: UnsignedCall;
  constructor(call: UnsignedCall, reason: string) {
    super(`${call.description} would revert: ${reason}`);
    this.name = "WouldRevert";
    this.call = call;
  }
}

/**
 * Signs nothing, but asks the node whether the call would work.
 *
 * The gap this closes: {@link DryRunSigner} proves the keeper builds the
 * calldata it means to build, and proves nothing about whether that calldata
 * survives contact with the EVM. A v4 mint pulls tokens through Permit2 and
 * touches the vault's venue allowlist, its caps and its balances, and every one
 * of those can reject a call that is encoded perfectly.
 *
 * eth_estimateGas executes the whole call against current state and reverts
 * exactly where a real send would, so this is that same test for the price of
 * an RPC round trip. It is worth more than the same run on a testnet: the state
 * it executes against is the real pool, the real allowlist and the real
 * balance, not an imitation of them.
 *
 * It needs the keeper's ADDRESS and not its key. Take the address from
 * `npm run newkey` and leave the key wherever it is until the simulation is
 * clean.
 */
export class SimulatingSigner implements Signer {
  readonly dryRun = true;
  readonly description: string;
  readonly calls: UnsignedCall[] = [];
  private readonly rpc: (method: string, params: unknown[]) => Promise<unknown>;
  private readonly from: string;

  constructor(
    rpc: (method: string, params: unknown[]) => Promise<unknown>,
    from: string,
  ) {
    this.rpc = rpc;
    this.from = from;
    this.description = `simulating as ${from} (signs nothing)`;
  }

  async address(): Promise<string> {
    return this.from;
  }

  async send(call: UnsignedCall): Promise<SentCall> {
    this.calls.push(call);
    try {
      await this.rpc("eth_estimateGas", [
        {
          from: this.from,
          to: call.to,
          data: call.data,
          value: `0x${(call.value ?? 0n).toString(16)}`,
        },
      ]);
    } catch (error) {
      // A revert here is the finding, not a failure of the run: it is the
      // discovery that would otherwise have cost a mint's worth of gas.
      throw new WouldRevert(call, error instanceof Error ? error.message : String(error));
    }
    return { hash: `sim:${this.calls.length}` };
  }
}

/**
 * A signer backed by something outside this process — a KMS, an HSM, a remote
 * signing service.
 *
 * The keeper never sees key material: it hands over a call and gets a hash
 * back. Which service is behind `submit` is a deployment decision, and the
 * point of the indirection is that changing it cannot change what the keeper is
 * allowed to do.
 */
export class RemoteSigner implements Signer {
  readonly dryRun = false;
  readonly description: string;
  private readonly from: string;
  private readonly submit: (call: UnsignedCall) => Promise<SentCall>;

  constructor(
    from: string,
    submit: (call: UnsignedCall) => Promise<SentCall>,
    description = "remote signer",
  ) {
    this.from = from;
    this.submit = submit;
    this.description = description;
  }

  async address(): Promise<string> {
    return this.from;
  }

  send(call: UnsignedCall): Promise<SentCall> {
    return this.submit(call);
  }
}

export type SignerCheck = {
  ok: boolean;
  /** Everything wrong. A signer is not usable until this is empty. */
  problems: string[];
};

/**
 * Refuse a signer that is the vault owner, or that is not the keeper.
 *
 * Called before the first intent of every run rather than at configuration
 * time, because the vault's keeper can be rotated underneath a running process
 * and the answer that matters is the one the chain gives now.
 */
export function checkSigner(
  signerAddress: string,
  vault: { owner: string; keeper: string },
): SignerCheck {
  const problems: string[] = [];
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  if (same(signerAddress, vault.owner)) {
    problems.push(
      "the signer is the vault owner. The keeper must not be able to change " +
        "venues, caps, or the payout asset.",
    );
  }
  if (!same(signerAddress, vault.keeper)) {
    problems.push(
      `the signer ${signerAddress} is not the vault keeper ${vault.keeper}. ` +
        "Every call would revert.",
    );
  }
  if (same(vault.owner, vault.keeper)) {
    problems.push(
      "the vault's owner and keeper are the same address. Deploy with them " +
        "separated before funding.",
    );
  }

  return { ok: problems.length === 0, problems };
}
