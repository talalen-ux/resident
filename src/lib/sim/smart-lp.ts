/**
 * Smart-LP tracker.
 *
 * Attributes every liquidity add and remove on a watched pool to the wallet
 * behind it, values it at the pool price of that moment, and credits in-range
 * positions with their share of each swap's fee.
 *
 * The scoring rule that matters: only positions opened *and* closed inside the
 * window count toward the win/loss record. A wallet that has simply been sitting
 * in a pool since before the window is tracked but not judged — its paper
 * position is not evidence that it is good at this.
 */

export type LpEvent =
  | {
      kind: "add";
      wallet: string;
      /** Position identity — the NFT token id, or a synthetic key. */
      positionId: string;
      /** Quote-denominated value deposited, at the pool price of that moment. */
      value: number;
      at: number;
    }
  | {
      kind: "remove";
      wallet: string;
      positionId: string;
      /** Quote-denominated value withdrawn, at the pool price of that moment. */
      value: number;
      at: number;
    }
  | {
      kind: "fee";
      wallet: string;
      positionId: string;
      /** Quote-denominated fees credited to this position. */
      value: number;
      at: number;
    };

export type WalletTag = "wallet" | "bot" | "desk";

export type WalletScore = {
  wallet: string;
  tag: WalletTag;
  deposited: number;
  withdrawn: number;
  feesCredited: number;
  /** Marked value of positions still open at the end of the window. */
  openValue: number;
  /** withdrawn − deposited + open + fees. */
  score: number;
  /** Positions opened and closed inside the window. */
  closedInWindow: number;
  wins: number;
  losses: number;
  /** Open positions at the end of the window. */
  openPositions: number;
  /** A consistent winner over the window, not a lucky one. */
  smart: boolean;
};

export type TrackerConfig = {
  windowMs: number;
  /** Minimum closed positions before a wallet can be called smart. */
  minClosedPositions: number;
  /** Fraction of closed positions that must be wins. */
  minWinRate: number;
  /** Minimum net score, quote units. */
  minScore: number;
};

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  windowMs: 7 * 24 * 60 * 60 * 1000,
  minClosedPositions: 3,
  minWinRate: 0.6,
  minScore: 0,
};

export type TrackerInput = {
  events: LpEvent[];
  /** Current mark for positions still open, by position id. */
  openMarks: Record<string, number>;
  /** Addresses known to be contracts. */
  contracts?: Set<string>;
  /** The desk's own wallet, so the tracker never scores itself. */
  deskWallet?: string;
  now?: number;
};

/**
 * Score every wallet that touched the pool inside the window.
 *
 * `smart` requires a record, not a single outcome: enough closed positions to
 * mean something, a win rate above the threshold, and a positive net score.
 * One lucky exit does not qualify.
 */
export function scoreWallets(
  input: TrackerInput,
  config: TrackerConfig = DEFAULT_TRACKER_CONFIG,
): WalletScore[] {
  const now = input.now ?? Date.now();
  const cutoff = now - config.windowMs;
  const contracts = input.contracts ?? new Set<string>();
  const desk = input.deskWallet?.toLowerCase();

  const inWindow = input.events.filter((e) => e.at >= cutoff);

  type Acc = {
    deposited: number;
    withdrawn: number;
    fees: number;
    openedInWindow: Set<string>;
    closed: Set<string>;
    openIds: Set<string>;
    perPosition: Map<string, { in: number; out: number; fees: number }>;
  };
  const wallets = new Map<string, Acc>();

  const acc = (w: string): Acc => {
    const key = w.toLowerCase();
    let a = wallets.get(key);
    if (!a) {
      a = {
        deposited: 0, withdrawn: 0, fees: 0,
        openedInWindow: new Set(), closed: new Set(), openIds: new Set(),
        perPosition: new Map(),
      };
      wallets.set(key, a);
    }
    return a;
  };

  const pos = (a: Acc, id: string) => {
    let p = a.perPosition.get(id);
    if (!p) { p = { in: 0, out: 0, fees: 0 }; a.perPosition.set(id, p); }
    return p;
  };

  for (const e of inWindow) {
    const a = acc(e.wallet);
    const p = pos(a, e.positionId);
    if (e.kind === "add") {
      a.deposited += e.value;
      p.in += e.value;
      a.openedInWindow.add(e.positionId);
      a.openIds.add(e.positionId);
    } else if (e.kind === "remove") {
      a.withdrawn += e.value;
      p.out += e.value;
      a.closed.add(e.positionId);
      a.openIds.delete(e.positionId);
    } else {
      a.fees += e.value;
      p.fees += e.value;
    }
  }

  const scores: WalletScore[] = [];
  for (const [wallet, a] of wallets) {
    const openValue = [...a.openIds].reduce(
      (sum, id) => sum + (input.openMarks[id] ?? 0),
      0,
    );

    // Only positions that both opened and closed inside the window are judged.
    const judged = [...a.closed].filter((id) => a.openedInWindow.has(id));
    let wins = 0;
    let losses = 0;
    for (const id of judged) {
      const p = a.perPosition.get(id)!;
      const pnl = p.out + p.fees - p.in;
      if (pnl > 0) wins++;
      else losses++;
    }

    const score = a.withdrawn - a.deposited + openValue + a.fees;

    const tag: WalletTag =
      desk && wallet === desk ? "desk" : contracts.has(wallet) ? "bot" : "wallet";

    const smart =
      tag === "wallet" &&
      judged.length >= config.minClosedPositions &&
      wins / Math.max(1, judged.length) >= config.minWinRate &&
      score > config.minScore;

    scores.push({
      wallet,
      tag,
      deposited: a.deposited,
      withdrawn: a.withdrawn,
      feesCredited: a.fees,
      openValue,
      score,
      closedInWindow: judged.length,
      wins,
      losses,
      openPositions: a.openIds.size,
      smart,
    });
  }

  return scores.sort((x, y) => y.score - x.score);
}

export type PoolSmartSummary = {
  /** Smart wallets holding a position right now. */
  present: number;
  /** Value those wallets hold. */
  presentValue: number;
  /** Smart wallets that entered in the last hour. */
  entered1h: number;
  /** Smart wallets that left in the last hour. */
  exited1h: number;
  /** Winners minus losers among judged wallets — the "LPs winning" gate. */
  net: number;
};

/** Roll wallet scores up into the per-pool figures the board shows. */
export function summarisePool(
  scores: WalletScore[],
  events: LpEvent[],
  now = Date.now(),
): PoolSmartSummary {
  const smart = new Set(scores.filter((s) => s.smart).map((s) => s.wallet));
  const hourAgo = now - 60 * 60 * 1000;

  const recent = events.filter((e) => e.at >= hourAgo && smart.has(e.wallet.toLowerCase()));

  const present = scores.filter((s) => s.smart && s.openPositions > 0);

  const judged = scores.filter((s) => s.tag === "wallet" && s.closedInWindow > 0);
  const winners = judged.filter((s) => s.wins > s.losses).length;
  const losers = judged.filter((s) => s.losses >= s.wins).length;

  return {
    present: present.length,
    presentValue: present.reduce((sum, s) => sum + s.openValue, 0),
    entered1h: new Set(recent.filter((e) => e.kind === "add").map((e) => e.wallet)).size,
    exited1h: new Set(recent.filter((e) => e.kind === "remove").map((e) => e.wallet)).size,
    net: winners - losers,
  };
}
