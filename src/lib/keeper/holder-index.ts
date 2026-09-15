/**
 * Who holds the token, kept current as blocks arrive.
 *
 * The vault enforces the 15% split and refuses to pay more than it owes, but
 * distribute() takes a list of recipients and amounts: the contract cannot know
 * who the holders are. Building that list is the last thing standing between
 * the split existing and holders being paid.
 *
 * It is built from Transfer logs rather than an indexer, for the same reason
 * the pool board is: it is the chain's own record, and it cannot be stale in a
 * way nobody notices.
 *
 * Replaying every transfer on every distribution would be wasteful and, on a
 * token with any history, slow enough to miss the cycle. So the index is
 * incremental — it holds balances and the last block it read, and each refresh
 * covers only what has happened since. A restart rebuilds from genesis, which
 * is correct and slow, and correct is the half that matters.
 */

import { balancesFrom, type Log } from "./holders.ts";

export type LogReader = (params: {
  address: string;
  fromBlock: number;
  toBlock: number;
}) => Promise<Log[]>;

export type HolderIndexOptions = {
  /** Most blocks to ask for in one eth_getLogs. Most RPCs cap this. */
  maxBlockSpan?: number;
  /** Block the token was deployed at, so a rebuild does not start at zero. */
  deployedAt?: number;
};

export class HolderIndex {
  private readonly balances = new Map<string, bigint>();
  private readonly read: LogReader;
  private readonly token: string;
  private readonly maxBlockSpan: number;
  private cursor: number;

  constructor(read: LogReader, token: string, options: HolderIndexOptions = {}) {
    this.read = read;
    this.token = token;
    this.maxBlockSpan = options.maxBlockSpan ?? 10_000;
    this.cursor = options.deployedAt ?? 0;
  }

  /** The last block this index has read. */
  get syncedTo(): number {
    return this.cursor;
  }

  get size(): number {
    return this.balances.size;
  }

  /**
   * Read forward to `head`, in chunks the node will accept.
   *
   * Chunks are applied as they arrive rather than gathered and applied at the
   * end: a failure partway through then leaves the index correct as far as it
   * got, and the next refresh continues from there instead of re-reading
   * everything.
   */
  async refresh(head: number): Promise<{ blocks: number; holders: number }> {
    const start = this.cursor;
    while (this.cursor < head) {
      const from = this.cursor === 0 ? 0 : this.cursor + 1;
      const to = Math.min(from + this.maxBlockSpan - 1, head);
      const logs = await this.read({ address: this.token, fromBlock: from, toBlock: to });
      this.apply(logs);
      this.cursor = to;
    }
    return { blocks: head - start, holders: this.balances.size };
  }

  /** Fold a batch of Transfer logs into the running balances. */
  private apply(logs: Log[]): void {
    for (const [address, delta] of balancesFrom(logs)) {
      const next = (this.balances.get(address) ?? 0n) + delta;
      if (next === 0n) this.balances.delete(address);
      else this.balances.set(address, next);
    }
  }

  /** A copy, so a caller cannot mutate the index by holding its map. */
  snapshot(): Map<string, bigint> {
    return new Map(this.balances);
  }
}
