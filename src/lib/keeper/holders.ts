/**
 * Who holds the token, and what each is owed.
 *
 * The vault enforces the 15% split and refuses to pay more than it owes, but it
 * cannot know who the holders are: distribute() takes a list. Building that
 * list correctly is this module's whole job, and every mistake in it is a
 * payment to the wrong address or a holder silently missed.
 *
 * The list is derived from Transfer logs rather than from an indexer. It is
 * slower and it is the only version that cannot be stale or wrong in a way
 * nobody notices: the chain's own record of every movement, replayed.
 */

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type Log = { topics: string[]; data: string; blockNumber?: string };

const addressFrom = (topic: string) => `0x${topic.slice(26).toLowerCase()}`;
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Replay transfers into balances.
 *
 * Mints and burns are movements to and from the zero address and are applied
 * like any other: a token's whole supply arrives as a mint, so skipping them
 * would leave every balance short by exactly what was minted to it.
 */
export function balancesFrom(logs: Log[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const add = (address: string, delta: bigint) => {
    if (address === ZERO) return;
    const next = (balances.get(address) ?? 0n) + delta;
    if (next === 0n) balances.delete(address);
    else balances.set(address, next);
  };

  for (const log of logs) {
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const value = !log.data || log.data === "0x" ? 0n : BigInt(log.data);
    add(addressFrom(log.topics[1]), -value);
    add(addressFrom(log.topics[2]), value);
  }
  return balances;
}

export type Allocation = { recipient: string; amount: bigint };

export type SplitOptions = {
  /**
   * Addresses that hold the token but are not holders to be paid: the vault
   * itself, the bonding curve, a locker, a burn address. Paying the vault its
   * own distribution would book the payment and move nothing.
   */
  exclude?: string[];
  /**
   * Do not pay an address less than this, in minor units.
   *
   * A payment smaller than the gas it costs to make is a loss, and a list of
   * them is a loss repeated. What is skipped stays owed and rolls into the next
   * cycle rather than being forfeited.
   */
  dust?: bigint;
  /** Never build a list longer than this. Gas is finite per transaction. */
  maxRecipients?: number;
};

/**
 * Split an amount across holders, pro rata by balance.
 *
 * Integer arithmetic throughout, and the total is never allowed to exceed the
 * amount: the vault reverts if it does, so a rounding error that rounds UP
 * costs a whole cycle. Remainder from rounding stays with the vault and is
 * distributed next time.
 */
export function splitPro(
  balances: Map<string, bigint>,
  amount: bigint,
  options: SplitOptions = {},
): { allocations: Allocation[]; total: bigint; skipped: number } {
  const dust = options.dust ?? 0n;
  const max = options.maxRecipients ?? 400;
  const excluded = new Set((options.exclude ?? []).map((a) => a.toLowerCase()));

  const eligible = [...balances.entries()]
    .filter(([address, balance]) => balance > 0n && !excluded.has(address.toLowerCase()))
    // Largest first, so that when the list has to be truncated the holders who
    // are dropped are the ones owed least.
    .sort((a, b) => (b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] > a[1] ? 1 : -1));

  const supply = eligible.reduce((sum, [, balance]) => sum + balance, 0n);
  if (supply === 0n || amount <= 0n) {
    return { allocations: [], total: 0n, skipped: 0 };
  }

  const allocations: Allocation[] = [];
  let total = 0n;
  let skipped = 0;

  for (const [recipient, balance] of eligible) {
    if (allocations.length >= max) {
      skipped++;
      continue;
    }
    // Floor division, always. Rounding up here is how the sum exceeds what the
    // vault owes and the whole call reverts.
    const share = (amount * balance) / supply;
    if (share < dust || share === 0n) {
      skipped++;
      continue;
    }
    allocations.push({ recipient, amount: share });
    total += share;
  }

  return { allocations, total, skipped };
}
