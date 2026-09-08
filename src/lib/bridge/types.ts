/**
 * Moving capital between Robinhood Chain and Solana.
 *
 * WHAT THIS CHANGES ABOUT THE SECURITY MODEL — read before implementing.
 *
 * Every guarantee ResidentVault makes is an EVM guarantee. exec() reverts on a
 * target outside the allowlist; approvals are spender-gated; distributions are
 * rate-limited. None of that reaches across a bridge. The moment capital leaves
 * for Solana it is outside the contract that protects it, held by whatever
 * key signs there, and the vault cannot claw it back or even see it.
 *
 * Concretely, a keeper that can bridge is a keeper that can move funds to a
 * chain where the allowlist does not exist. Today a compromised keeper can only
 * shuffle assets between approved venues; with a bridge it can send them
 * somewhere the contract has no authority at all. That is a categorical change
 * in blast radius, not an incremental one, and it should be reflected in the
 * contract before it ships: a per-destination cap and a rate limit on bridged
 * value, at minimum, so the exposure is bounded by policy rather than by trust
 * in the keeper.
 *
 * ON CHOOSING A BRIDGE
 *
 * This interface is deliberately implementation-free. The routes that exist at
 * the time of writing:
 *
 *   deBridge     direct Solana <-> Robinhood Chain
 *   Hood Bridge  ~2 minutes, 0.25% flat
 *   Across       no direct Solana pair; routes via an intermediate EVM chain,
 *                which means two bridges and two sets of costs, not one
 *
 * A privacy or "instant exchange" service is a different kind of thing and is
 * not a fit here whatever its fees. This protocol holds tokenized equities and
 * a Paxos stablecoin, tells holders their money is auditable on-chain, and
 * publishes a positions page. Routing custody funds through something whose
 * purpose is to break the link to their origin contradicts that claim and
 * invites a regulatory question nobody wants to answer mid-launch.
 */

export type BridgeQuote = {
  /** What arrives, in quote units, after the bridge takes its cut. */
  received: number;
  /** Proportional fee for this leg. */
  feeFraction: number;
  /** Fixed cost of this leg: gas both sides, relayer, expected slippage. */
  fixedCost: number;
  /** Expected transit, in the same intervals the allocator uses (minutes). */
  latencyIntervals: number;
  /** How long this quote can be trusted. */
  expiresAt: string;
};

export type BridgeTransfer = {
  id: string;
  status: "pending" | "settled" | "failed";
  /** Set once settled; may differ from the quote. */
  receivedActual?: number;
};

export interface Bridge {
  readonly name: string;
  readonly from: string;
  readonly to: string;

  /**
   * Price a leg without committing to it.
   *
   * The allocator needs this before it can decide anything: a move is only
   * worth making if the edge covers the round trip, and the round trip cannot
   * be known without asking. An implementation that returns a guess here makes
   * every downstream decision a guess.
   */
  quote(amount: number): Promise<BridgeQuote>;

  /** Send. Returns once submitted, not once settled. */
  send(amount: number, recipient: string): Promise<BridgeTransfer>;

  /** Poll a transfer. The allocator treats pending capital as idle, not lost. */
  status(id: string): Promise<BridgeTransfer>;
}

/**
 * No bridge is wired in.
 *
 * Returned where an implementation would go, so the desk reports that it cannot
 * cross rather than behaving as though the cost were zero — which is what a
 * stub returning plausible numbers would do, and it would read as a profitable
 * move every time.
 */
export class UnavailableBridge implements Bridge {
  readonly name = "none";
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    this.from = from;
    this.to = to;
  }

  private fail(): never {
    throw new Error(
      `No bridge is configured for ${this.from} -> ${this.to}. ` +
        "Cross-chain allocation is inert until one is.",
    );
  }

  async quote(): Promise<BridgeQuote> {
    this.fail();
  }
  async send(): Promise<BridgeTransfer> {
    this.fail();
  }
  async status(): Promise<BridgeTransfer> {
    this.fail();
  }
}
