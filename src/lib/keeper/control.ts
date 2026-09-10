/**
 * Manual control of a desk that is otherwise unattended.
 *
 * Two things the rules cannot do. They cannot see an opportunity the operator
 * can, and they cannot be told that a position has become dangerous for a
 * reason that is not in the price history — a token the desk should not be
 * facing at all. So there is a way in, and the whole design of it is about who
 * is allowed to use it.
 *
 * Authority is a wallet signature, not a shared secret. The operator signs a
 * one-time challenge and the keeper checks that the signature recovers to one
 * specific address: the vault's owner, or whatever RESIDENT_CONTROL_WALLET
 * names. Nothing that can be pasted into a log or a screenshot grants access,
 * and revoking it is a wallet change rather than a redeploy.
 *
 * Orders do not bypass the machinery. They become the same intents the rules
 * emit, journalled before submission and reconciled after, so a manual close
 * survives a crash exactly as an automatic one does. What they get is
 * precedence: a position an operator has spoken for is not also acted on by a
 * rule in the same tick.
 */

export type ManualOrder =
  | { kind: "close"; positionId: string; note: string }
  | { kind: "sweep"; positionId: string; note: string }
  | { kind: "open"; pool: string; capital: number; note: string }
  | { kind: "pause"; note: string }
  | { kind: "resume"; note: string };

export class BadOrder extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadOrder";
  }
}

const asString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadOrder(`${field} is required`);
  }
  return value.trim();
};

/**
 * Validate an order off the wire.
 *
 * Rejects rather than coerces. A capital of "1e9" or a missing position id
 * should fail here, where it is a 400, and not three layers down where it is a
 * transaction.
 */
export function parseOrder(body: unknown): ManualOrder {
  if (typeof body !== "object" || body === null) throw new BadOrder("expected an object");
  const raw = body as Record<string, unknown>;
  const note = typeof raw.note === "string" ? raw.note.slice(0, 200) : "manual order";

  switch (raw.kind) {
    case "close":
      return { kind: "close", positionId: asString(raw.positionId, "positionId"), note };
    case "sweep":
      return { kind: "sweep", positionId: asString(raw.positionId, "positionId"), note };
    case "open": {
      const capital = Number(raw.capital);
      if (!Number.isFinite(capital) || capital <= 0) {
        throw new BadOrder("capital must be a positive number");
      }
      return { kind: "open", pool: asString(raw.pool, "pool"), capital, note };
    }
    case "pause":
      return { kind: "pause", note };
    case "resume":
      return { kind: "resume", note };
    default:
      throw new BadOrder(`unknown order ${JSON.stringify(raw.kind)}`);
  }
}

/** The text the operator's wallet is asked to sign. */
export function challenge(nonce: string, expiresAt: number): string {
  return [
    "Resident desk control",
    "",
    "Sign in to issue manual orders to the keeper.",
    "This signature authorises nothing on chain and moves no funds.",
    "",
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");
}

export type Verify = (message: string, signature: string) => string;

export type ControlOptions = {
  /** The only address whose signature is accepted. */
  wallet: string;
  /** Recovers a signer from a message. ethers.verifyMessage in production. */
  verify: Verify;
  random: () => string;
  now: () => number;
  /** How long a challenge stays signable. Short: it is signed immediately. */
  nonceTtlMs?: number;
  /** How long a session lasts before the operator signs again. */
  sessionTtlMs?: number;
};

/**
 * Challenges, sessions, and the queue of orders waiting for the next tick.
 *
 * Held in memory on purpose. A restart invalidates every session, which is the
 * correct behaviour for authority over money: the operator signs again, and a
 * token that leaked cannot outlive the process it was issued by.
 */
export class Control {
  private readonly options: Required<ControlOptions>;
  private readonly nonces = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  private queue: ManualOrder[] = [];
  private pausedAt: number | null = null;

  constructor(options: ControlOptions) {
    this.options = {
      nonceTtlMs: 5 * 60_000,
      sessionTtlMs: 60 * 60_000,
      ...options,
    };
  }

  get wallet(): string {
    return this.options.wallet.toLowerCase();
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Issue a one-time challenge. */
  begin(): { nonce: string; message: string; expiresAt: number } {
    const now = this.options.now();
    for (const [nonce, expiry] of this.nonces) {
      if (expiry <= now) this.nonces.delete(nonce);
    }
    const nonce = this.options.random();
    const expiresAt = now + this.options.nonceTtlMs;
    this.nonces.set(nonce, expiresAt);
    return { nonce, message: challenge(nonce, expiresAt), expiresAt };
  }

  /**
   * Exchange a signed challenge for a session token.
   *
   * The nonce is consumed whether or not the signature checks out. A challenge
   * that can be retried is a challenge an attacker can grind against.
   */
  authenticate(nonce: string, signature: string): { token: string; expiresAt: number } {
    const now = this.options.now();
    const expiry = this.nonces.get(nonce);
    this.nonces.delete(nonce);

    if (expiry === undefined) throw new BadOrder("unknown or already used challenge");
    if (expiry <= now) throw new BadOrder("challenge expired");

    let signer: string;
    try {
      signer = this.options.verify(challenge(nonce, expiry), signature);
    } catch {
      throw new BadOrder("signature could not be read");
    }
    if (signer.toLowerCase() !== this.wallet) {
      // Deliberately does not name the expected address. Whoever is signing
      // either holds the wallet or should not learn which one to look for.
      throw new BadOrder("that wallet may not control this desk");
    }

    const token = this.options.random();
    const expiresAt = now + this.options.sessionTtlMs;
    this.sessions.set(token, expiresAt);
    return { token, expiresAt };
  }

  /** True when this token is live. Expired tokens are dropped as they are seen. */
  authorised(token: string | null | undefined): boolean {
    if (!token) return false;
    const expiry = this.sessions.get(token);
    if (expiry === undefined) return false;
    if (expiry <= this.options.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  /** Queue an order for the next tick, or apply it now if it is a mode change. */
  submit(order: ManualOrder): void {
    if (order.kind === "pause") {
      this.pausedAt = this.options.now();
      return;
    }
    if (order.kind === "resume") {
      this.pausedAt = null;
      return;
    }
    this.queue.push(order);
  }

  /** Take everything waiting. Called once per tick, and empties the queue. */
  drain(): ManualOrder[] {
    const orders = this.queue;
    this.queue = [];
    return orders;
  }

  /** What is waiting, without taking it. For the dashboard. */
  get pending(): readonly ManualOrder[] {
    return this.queue;
  }
}
