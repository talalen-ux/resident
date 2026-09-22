/**
 * When a distribution is worth making, and to whom.
 *
 * Two problems, and the second is the one that bites first.
 *
 * GAS. The vault pays holders in a loop, so cost scales with the number of
 * recipients and not with the amount. At 35,000 gas a transfer, paying 5,000
 * holders every fifteen minutes is 175M gas a cycle — over a block limit, and
 * at 1 gwei about $50,000 a day. A fifteen-minute cadence is a promise about
 * frequency that only a gas subsidy can keep, and a subsidy is somebody else's
 * decision to withdraw.
 *
 * FAIRNESS. Capping the recipient list and sorting by balance sounds prudent
 * and is not: balances barely move between cycles, so the same names clear the
 * cap every time and everyone below it is never paid. Not paid later — never.
 *
 * Both have the same root, which is that pro-rata of a small amount across many
 * holders produces per-holder amounts smaller than the cost of sending them.
 * $300 across 5,000 holders is six cents each, and six cents costs more than
 * six cents to move.
 *
 * So the cadence follows the payout rather than the clock. A distribution runs
 * when there is enough for every eligible holder to clear a floor worth paying,
 * and when gas is a small enough share of what is being paid. Fewer, larger,
 * complete distributions — instead of frequent partial ones that quietly pay
 * the same few people.
 */

export type DistributionConfig = {
  /**
   * Smallest payment worth making, in quote units.
   *
   * Below this the transfer costs more than it delivers. Skipping does not
   * forfeit anything: the entitlement stays in the vault's ledger and the next
   * distribution is larger.
   */
  minPayment: number;
  /**
   * Most of a distribution that may go to gas, as a fraction.
   *
   * The same discipline the sweep rule applies, for the same reason: a payment
   * that costs a fifth of itself to make is not a payment, it is a fee.
   */
  maxGasShare: number;
  /** Gas one ERC20 transfer costs inside the vault's loop. */
  gasPerRecipient: number;
  /** Gas the call costs before any transfer. */
  gasOverhead: number;
  /** Most recipients in one call, from what fits in a block. */
  maxRecipients: number;
};

export const DEFAULT_DISTRIBUTION: DistributionConfig = {
  minPayment: 1,
  maxGasShare: 0.02,
  // Measured shape rather than a guess: a CALL plus an SSTORE on the
  // recipient's balance, which is ~51k cold and ~35k once warm.
  gasPerRecipient: 35_000,
  gasOverhead: 50_000,
  // A 30M block holds about 855 transfers. Stay well under it: a distribution
  // that only fits in an empty block does not land in a busy one.
  maxRecipients: 500,
};

export type DistributionPlan = {
  distribute: boolean;
  /** Holders who would be paid. */
  recipients: number;
  /** Quote units that would go out. */
  amount: number;
  /** Quote units of gas it would cost. */
  gasCost: number;
  reason: string;
};

/**
 * Should a distribution run now?
 *
 * `owed` is what the contract says holders are entitled to. `eligible` is how
 * many holders would share it. `gasPrice` is in quote units per gas unit, so
 * the caller converts once rather than this module guessing at a token price.
 */
export function planDistribution(
  inputs: { owed: number; eligible: number; gasPrice: number },
  config: DistributionConfig = DEFAULT_DISTRIBUTION,
): DistributionPlan {
  const { owed, eligible } = inputs;

  if (!(owed > 0)) {
    return { distribute: false, recipients: 0, amount: 0, gasCost: 0, reason: "nothing is owed" };
  }
  if (!(eligible > 0)) {
    return { distribute: false, recipients: 0, amount: 0, gasCost: 0, reason: "no eligible holders" };
  }

  // Everyone who is paid must be worth paying. Distributing to a subset while
  // the rest wait is how the same names get paid forever.
  const affordable = Math.floor(owed / config.minPayment);
  const recipients = Math.min(eligible, affordable, config.maxRecipients);

  if (recipients < eligible && affordable < eligible) {
    const needed = eligible * config.minPayment;
    return {
      distribute: false,
      recipients: 0,
      amount: 0,
      gasCost: 0,
      reason:
        `${owed.toFixed(2)} across ${eligible} holders is ` +
        `${(owed / eligible).toFixed(4)} each, under the ${config.minPayment} floor. ` +
        `Waiting for ${needed.toFixed(0)}; nothing is forfeited by waiting`,
    };
  }

  const gasCost =
    (config.gasOverhead + recipients * config.gasPerRecipient) * inputs.gasPrice;
  const share = gasCost / owed;

  if (share > config.maxGasShare) {
    return {
      distribute: false,
      recipients,
      amount: 0,
      gasCost,
      reason:
        `gas would be ${gasCost.toFixed(2)} on a ${owed.toFixed(2)} distribution, ` +
        `${(share * 100).toFixed(1)}% of it. The limit is ` +
        `${(config.maxGasShare * 100).toFixed(0)}%`,
    };
  }

  return {
    distribute: true,
    recipients,
    amount: owed,
    gasCost,
    reason:
      `${owed.toFixed(2)} to ${recipients} holders, gas ${gasCost.toFixed(2)} ` +
      `(${(share * 100).toFixed(2)}%)`,
  };
}

/**
 * Rotate which holders are paid when the list has to be truncated.
 *
 * Sorting by balance and taking the top N is the intuitive choice and it is
 * wrong: balances move slowly, so the same names clear the cap every cycle and
 * the tail is never paid at all. Rotating by cycle means every holder is
 * reached within ceil(total / cap) cycles, which is a bound rather than a hope.
 *
 * The order within a rotation is by address, not by balance, so it does not
 * drift as balances change and a holder cannot move themselves up the queue.
 */
export function rotate<T>(items: T[], cap: number, cycle: number): T[] {
  if (items.length <= cap || cap <= 0) return items;
  const groups = Math.ceil(items.length / cap);
  const start = (cycle % groups) * cap;
  return items.slice(start, start + cap);
}
