/**
 * The page for after the launch, written for whoever holds the token.
 *
 * Deliberately not the docs. /docs explains how the desk decides; this
 * explains what a holder gets, when, and how to check it without asking
 * anyone. Someone who has just bought $RES has three questions in this order —
 * what is this, when do I get paid, how do I know it is real — and the page
 * answers them in that order.
 *
 * Two rules on the writing. No claim here that the protocol cannot keep: the
 * cadence follows the payout rather than a clock, the returns are not
 * promised, and the risks are stated in the same plain words as the upside.
 * And no number that is not read from the code that enforces it, so the
 * figures below are bound by test/parameters.test.mjs rather than maintained
 * by hand.
 */

export const HERO_HEADLINE = "$RES is live. Here is what it does with your fees.";

export const HERO_STANDFIRST =
  "Every trade in $RES pays a fee. Those fees do not sit in a treasury and they are not burned. They are deployed as liquidity in other pools on Robinhood Chain, where they earn again.";

export const HERO_NOTE =
  "15% of realized profit is paid to holders in USDG. No staking, no claiming, no lockup. The other 85% keeps working.";

/** The three things a holder most wants to know, above everything else. */
export const HEADLINES = [
  {
    figure: "15%",
    label: "of realized profit",
    note: "Paid in USDG, straight to your wallet. The split is a constant in the contract, not a setting anyone can change.",
  },
  {
    figure: "0",
    label: "actions required",
    note: "Nothing to stake, nothing to claim, nothing to sign. Holding the token is the whole of it.",
  },
  {
    figure: "85%",
    label: "stays at work",
    note: "Retained as capital and redeployed. The position the protocol can take grows with what it has earned.",
  },
] as const;

/** What happens between a trade and a payout, in the order it happens. */
export const CYCLE = [
  {
    step: "A trade pays a fee",
    body: "Buying or selling $RES pays a trading fee, the way it does on any pool. That fee is routed to the protocol's vault rather than to a wallet.",
  },
  {
    step: "The desk puts it to work",
    body: "A keeper ranks every pool it can reach on Robinhood Chain and opens a concentrated liquidity position in the ones where the fees are expected to beat the cost of the price moving. It checks every minute.",
  },
  {
    step: "Those positions earn",
    body: "Traders in those pools pay fees to whoever is providing the liquidity. For the duration of the position, that is the protocol.",
  },
  {
    step: "Profit is collected and booked",
    body: "Fees are swept once they are worth more than the gas to collect them, converted back to USDG, and recorded on the vault as realized profit.",
  },
  {
    step: "You are paid",
    body: "15% of that realized profit is sent to holders in proportion to what they hold. The contract will not let more than that leave.",
  },
] as const;

export const PAYOUT_TITLE = "Getting paid";

export const PAYOUT_BODY = [
  "Distributions arrive as USDG in the wallet holding your $RES. There is nothing to claim and no deadline to miss. If you hold the token when a distribution runs, you are in it.",
  "Payouts are on realized profit, not on paper gains. A position that looks good and then gives it back pays nothing, which is the honest way round: you are paid on money the protocol actually has.",
] as const;

export const CADENCE_TITLE = "When";

export const CADENCE_BODY = [
  "There is no fixed schedule, and a fixed schedule would be a promise only a gas subsidy can keep. A distribution runs once every eligible holder is owed at least $5.",
  "That ties the cadence to the payout rather than to a clock. More holders means a longer wait and a larger payment, instead of the same payment eaten by the cost of sending it. Holders are paid in rotation, so nobody sits permanently at the back of the queue.",
] as const;

/** Verification, not reassurance. Every row is something a holder can open. */
export const VERIFY_TITLE = "Check it yourself";

export const VERIFY_INTRO =
  "None of this requires taking anyone's word. The protocol holds its money in one contract and writes what it does to a public chain.";

export const VERIFY = [
  {
    what: "The vault",
    how: "Every asset the protocol holds sits in one contract. Its balance, the profit it has booked, and what it owes holders are all readable on the explorer.",
  },
  {
    what: "The positions",
    how: "The positions page lists what is open right now, what each has earned, and how that income was split.",
  },
  {
    what: "The distributions",
    how: "Every payment is a transaction from the vault. They are visible on the explorer whether or not anyone announces them.",
  },
  {
    what: "The rules",
    how: "Every parameter the desk runs on is published in the docs, and the published figures are bound to the code by tests. If one changes without the other, the build fails.",
  },
] as const;

export const CUSTODY_TITLE = "Who can move the money";

export const CUSTODY_BODY = [
  "Two keys, and keeping them apart is the design. The keeper is an automated key that runs constantly; it can open and close positions on venues that were approved in advance, and it cannot withdraw anything. If it were stolen, it would be replaced in one transaction and no assets would move.",
  "The owner key can withdraw everything. It is held offline and signs rarely, by hand. That is a real concentration of trust and it is named here rather than buried: the protocol is not trustless, it is constrained.",
] as const;

export const RISK_TITLE = "What can go wrong";

export const RISKS = [
  {
    risk: "Providing liquidity can lose money",
    body: "When a price moves, a liquidity position ends up holding more of whatever fell. Fees have to beat that, and sometimes they do not. The desk refuses pools where the maths says they will not, but a model that is wrong loses money exactly as fast as no model.",
  },
  {
    risk: "The contracts are not audited",
    body: "They are tested against a real EVM, and the test suite runs on every change. That is not the same as an audit and is not offered as one.",
  },
  {
    risk: "The owner key is a single point of failure",
    body: "There is no timelock and no multisig enforcing a delay. Whoever holds that key can withdraw the vault.",
  },
  {
    risk: "Distributions depend on there being profit",
    body: "15% of nothing is nothing. A quarter where the desk breaks even pays holders nothing, and there is no floor underneath it.",
  },
] as const;

export const CLOSING_TITLE = "The short version";

export const CLOSING_BODY =
  "A token whose trading fees become working capital instead of a treasury balance. The capital provides liquidity, the liquidity earns fees, and 15% of what is actually realized goes to the people holding the token. Everything above is checkable on chain, and the parts that are not yet proven are named as such.";
