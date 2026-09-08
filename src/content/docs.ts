/**
 * Docs copy, written for someone who has never provided liquidity before.
 *
 * Headings read as a protocol's own documentation; the body underneath them is
 * plain English. Two rules held throughout the body: no term is used before it
 * is explained in ordinary words, and no number is softened. Plain language is
 * about the words, not the facts — the custody risk, the missing keeper and the
 * "these are ceilings, not results" caveat are all still here, just said in a
 * way a normal person can act on.
 *
 * Every threshold is read from the code it describes: the gates from
 * DEFAULT_ALERT_CONFIG in src/lib/sim/opportunity.ts, the width and entry rules
 * from DEFAULT_WIDTH_CONFIG / DEFAULT_ENTRY_CONFIG and the exits from
 * DEFAULT_EXIT_CONFIG in src/lib/sim/strategy.ts, the split from HOLDER_BPS in
 * contracts/ResidentVault.sol. Change one of those without changing this file
 * and the docs are wrong.
 */

export const TOKEN = "$RES";
export const CHAIN = "Robinhood Chain";
export const QUOTE = "USDG";

export const NAV_LINKS = [
  { label: "Overview", href: "#overview" },
  { label: "Capital", href: "#capital" },
  { label: "Pool selection", href: "#selection" },
  { label: "Range construction", href: "#width" },
  { label: "Entry criteria", href: "#entry" },
  { label: "Position management", href: "#management" },
  { label: "Distributions", href: "#accounting" },
  { label: "Custody", href: "#custody" },
  { label: "Parameters", href: "#parameters" },
] as const;

export const HERO_HEADLINE =
  "Protocol mechanics, parameters and current status.";

export const HERO_STANDFIRST =
  "Resident provides liquidity to tokenized equity pools on Robinhood Chain and earns a share of the fees paid there. Trading fees on $RES capitalize the positions. 15% of realized profit is distributed to holders every 15 minutes; 85% is retained as working capital.";

export const HERO_NOTE =
  "Every parameter below is the value the protocol runs with. Status, custody and risk are documented to the same standard.";

export const PILLARS = [
  {
    icon: "reference" as const,
    eyebrow: "Volatility-scaled ranges",
    body: "Range width is derived from each pool's measured volatility. Calm markets get a tight range, volatile ones a wider one.",
  },
  {
    icon: "probe" as const,
    eyebrow: "Risk-adjusted entry",
    body: "High fee income does not make a position profitable. Resident opens only when expected fees exceed the expected cost of price movement.",
  },
  {
    icon: "payout" as const,
    eyebrow: "Direct holder distributions",
    body: "15% of realized profit, distributed every 15 minutes in USDG. No staking, no claiming.",
  },
] as const;

/** The money's route, start to finish. */
export const CYCLE = [
  { step: "Token fees", note: "A fee is charged on every $RES trade" },
  { step: "The vault", note: "One wallet holds everything" },
  { step: "Selection", note: "A pool has to clear six checks" },
  { step: "Range", note: "Tight for calm pools, wide for jumpy ones" },
  {
    step: "Entry test",
    note: "Open only if fees should beat the swings",
  },
  {
    step: "Management",
    note: "Moved when the price walks away from it",
  },
  {
    step: "Realized profit",
    note: "Fees collected, minus what the swings cost",
  },
] as const;

export const METHOD = [
  {
    n: "01",
    id: "overview",
    title: "Protocol overview",
    body: [
      "When you swap one token for another, you are trading against a pool of money someone else put there. They put it up, and they get a small cut of every trade that uses it. That is what Resident does: it is the money in the pool, collecting the cut.",
      'The twist is that you do not have to cover every price. You can say "my money is only in play between $9 and $11". Inside that window you earn a much bigger share of the trades, because your money is concentrated where the action is. Outside it you earn nothing, and you just sit holding whatever the pool left you with.',
      "The protocol does three things: select pools worth being in, size a range the price will hold inside, and close a position once it no longer earns its keep.",
    ],
    pull: "You are not betting on the price going up. You are being paid rent for letting other people trade.",
  },
  {
    n: "02",
    id: "capital",
    title: "Sources of capital",
    body: [
      "Every time someone buys or sells $RES, a fee is charged. That fee goes into the vault, and the vault is what buys the positions. There is no raise, no VC round, no treasury sitting on the side.",
      "Capacity is therefore bounded by the token's own trading activity. Lower volume means less capital deployed and smaller distributions. The two are coupled by design, and nothing decouples them.",
    ],
  },
  {
    n: "03",
    id: "selection",
    title: "Pool selection",
    body: [
      "Six conditions, evaluated continuously. All six must hold; a pool that fails any one is not a candidate at any size.",
      "It has no custom code attached that could take the fees before they reach us. At least $25,000 has been traded in it in the last hour, because a quiet pool pays nothing. There is not too much money already in it — no more than $400,000 near the current price — because the more crowded it is, the smaller our slice. The price is still within 40% of its 24-hour high, so we are not the ones catching a falling knife. It is at least 20 minutes old, which skips the chaos of a brand-new launch. And other people providing money to that pool are currently making money, not losing it.",
      "A pool that stops qualifying remains on the board for 24 hours rather than disappearing, so activity that has already passed stays visible.",
    ],
  },
  {
    n: "04",
    id: "width",
    title: "Range construction",
    body: [
      "A narrow range earns more per trade but the price escapes it sooner. A wide range earns less but holds on longer. There is no setting that is good at both, so the width is worked out per pool from how much that pool actually bounces around.",
      "Halving the width roughly doubles the earnings and increases time spent out of range. Resident targets a width that holds the price inside approximately 91% of the time. Widening to 99.8% coverage would surrender about half the income for the remaining nine points, so it is not taken.",
      "Ranges are bounded at 1% and 60% either side of the price.",
    ],
  },
  {
    n: "05",
    id: "entry",
    title: "Entry criteria",
    body: [
      "When the price moves while capital sits in a range, the position ends up holding more of whichever asset fell and less of the one that rose — a worse outcome than holding both and doing nothing. This cost is real and scales with how far the price travels.",
      "A pool paying 3% a day into a book that moves 20% a day loses money while collecting fees. A board ranked on fee income recommends it every time.",
      "Resident prices both sides before opening: expected fee income against the expected cost of price movement, at that pool's own volatility. A position is opened only when fees exceed that cost.",
    ],
  },
  {
    n: "06",
    id: "management",
    title: "Position management",
    body: [
      "A position out of range earns nothing. It is not moved immediately, since prices cross an edge and return routinely, but a sustained move re-centres it on the new price.",
      "A position closes when net earnings — fees less the cost of price movement — fall 35% below the capital committed. A pool that stays unprofitable is dropped rather than re-centred: the pool has changed, not the position.",
      "Positions that move against the protocol are held and re-centred rather than sold into thin liquidity, which usually deepens the loss. The trade-off is that capital can remain committed to a weak market for an extended period.",
    ],
  },
  {
    n: "07",
    id: "accounting",
    title: "Fee distribution",
    body: [
      "Realized profit splits at a fixed ratio enforced by the contract: 15% to $RES holders, 85% retained to fund new positions.",
      "The holder share is distributed every 15 minutes in USDG, pro-rata by balance. No staking, no claiming, no signature. Distributions below $300 in total carry to the next cycle rather than spending more in gas than they deliver.",
      "The balance owed only increases until it is paid. Losses are absorbed by the retained share; profit already credited to holders is never reversed. Accrual pauses until the loss is recovered, so distributions go quiet in the interim.",
      "The retained 85% is working capital, not a deferred holder claim. It funds positions, absorbs losses, and holders have no claim on it.",
    ],
  },
  {
    n: "08",
    id: "limits",
    title: "Status and limitations",
    body: [
      "Resident is pre-deployment. The vault contract is complete and covered by a test suite; it has not been externally audited and is not deployed. No vault holds assets, and the positions page displays example data, labelled as such.",
      "The execution layer that opens and manages positions is not yet built. The repository contains the vault contract, the strategy implementation, and this site.",
      "Fee projections are modelled at full capture: they assume all pool volume transacts through the position's range. Measured against route-level simulation, realised capture was materially lower. Every projection on this site is an upper bound.",
    ],
  },
] as const;

export const LP_BANDS = [
  {
    mode: "standard",
    label: "Two-sided range",
    summary:
      "Money on both sides of the current price, so it earns whether the price ticks up or down. How wide the window is depends on how much that pool bounces around.",
    range: "from a bit below today's price to a bit above",
    lifecycle: [
      "Price wanders out and stays out → the window is picked up and re-centred.",
      "Earnings, after the cost of the swings, fall 35% below what went in → closed.",
      "The pool keeps losing money for long enough → dropped, not re-centred.",
    ],
  },
  {
    mode: "single-sided",
    label: "Bid-side range",
    summary:
      "Placed entirely underneath the current price, so it only fills if the price comes down to it. Used when we would rather buy the token at a price we picked than hold it on both sides.",
    range: "entirely below today's price",
    lifecycle: [
      "The price drops through it → we end up holding the token, at the price we chose.",
      "The price runs away upward → nothing happened; it is closed and re-placed higher.",
    ],
  },
] as const;

export const LP_EXPOSURE =
  "A position earns fees in exchange for absorbing the cost of price movement. Both sides are priced before entry, and a position that fails that test is not opened at any size.";

export const SIGNALS = [
  {
    title: "Opportunity ranking",
    body: "Pools ranked by what a $10,000 position would earn at current conditions. Share of flow is derived from the liquidity already sitting near the price, applied to trailing 5-minute, 1-hour, 6-hour and 24-hour volume.",
    detail:
      "Pools that stop qualifying fade over 24 hours rather than disappearing, so recent activity remains visible.",
    read: "The board ranks candidates. It does not open positions — every entry still has to clear the net test.",
  },
  {
    title: "Liquidity provider analytics",
    body: "Every add and remove on a tracked pool is attributed and valued at the price of that moment; every trade credits the positions in range. A seven-day score follows: withdrawals less deposits, plus open positions at current price, plus fees earned.",
    detail:
      "Only positions opened and closed inside the window count as wins or losses, so a wallet that simply holds is tracked but not scored. Contracts are tagged as bots and the protocol's own wallets as desk.",
    read: "Consistent winners holding a position is a signal. Consistent winners exiting one is a stronger signal.",
  },
] as const;

export const PAYOUT_STEPS = [
  {
    label: "Realized profit",
    body: "Fees collected less the cost of price movement. Monotonic — it only increases.",
  },
  {
    label: "Retained capital",
    body: "Working capital. Funds the next positions and absorbs losses. Holders have no claim on it.",
  },
  {
    label: "Holder allocation",
    body: "Owed to holders, carried forward until paid. It does not reset.",
  },
  {
    label: "Settlement",
    body: "Every 15 minutes in USDG, pro-rata by balance, once $300 is owed in total.",
  },
] as const;

export const SNAPSHOT_NOTE =
  "Holder balances are reconstructed from the token's complete transfer history, maintained locally rather than read from a third-party indexer, and verified against chain state before any value moves. Pools, protocol contracts and desk wallets are excluded from the eligible supply.";

export const INVARIANTS = [
  {
    invariant: "Everything lives at one address",
    mechanism:
      "Positions, cash and incoming fees all sit in the vault. The bot's own wallet only holds gas",
  },
  {
    invariant: "The bot can only trade approved places",
    mechanism:
      "Any other destination is rejected by the contract, not by policy",
  },
  {
    invariant: "Spending permissions cannot leak",
    mechanism: "Token approvals are limited to the same approved list",
  },
  {
    invariant: "Reported profit cannot be walked back",
    mechanism:
      "The total can only go up, so a report cannot be retracted to strand holders",
  },
  {
    invariant: "Only 15% can ever be paid out",
    mechanism:
      "The contract tracks the holder share separately and will not pay beyond it",
  },
  {
    invariant: "A loss cannot claw back your share",
    mechanism:
      "Absorbing a loss reduces the 85% and pauses new profit; it never reduces what holders are already owed",
  },
  {
    invariant: "Payouts are capped per day",
    mechanism: "A rolling 24-hour limit per asset, enforced by the contract",
  },
  {
    invariant: "The bot can be replaced instantly",
    mechanism: "One transaction swaps it out. The money does not move",
  },
  {
    invariant: "The owner can take everything",
    mechanism:
      "The deploying wallet can withdraw any asset at any time, without delay or governance. The keeper cannot. This is the protocol's principal risk, it is not mitigated by the contract, and it means Resident is not trustless",
    flagged: true,
  },
] as const;

export const PARAMETERS = [
  { meaning: "How wide the range is", value: "worked out per pool" },
  { meaning: "Narrowest and widest it can go", value: "1% – 60%" },
  {
    meaning: "Time the price stays in range, at that width",
    value: "about 91%",
  },
  { meaning: "Minimum traded in the last hour", value: "$25,000" },
  { meaning: "Maximum money already near the price", value: "$400,000" },
  { meaning: "Size used to rank the board", value: "$10,000" },
  { meaning: "Must still be within this much of the 24h high", value: "40%" },
  { meaning: "Minimum age of the pool", value: "20 minutes" },
  { meaning: "How long out of range before it is moved", value: "5 minutes" },
  {
    meaning: "How long unprofitable before the pool is dropped",
    value: "2 hours",
  },
  { meaning: "Loss that closes a position", value: "35% of what went in" },
  { meaning: "Holders' share of profit", value: "15%" },
  { meaning: "Minimum before a payout runs", value: "$300 owed" },
] as const;

export const CADENCES = [
  { label: "Pool evaluation", value: "constantly" },
  { label: "Distribution cycle", value: "every 15 minutes" },
  { label: "Board retention", value: "24 hours" },
  { label: "Analytics window", value: "over 7 days" },
] as const;

export const PARAMETERS_NOTE =
  "These are operating settings, not constants. They are published so the protocol's behaviour is predictable, and so that changing one is visible as a change.";

export const FAQS = [
  {
    question: "Who controls the vault?",
    answer:
      "The deploying wallet can withdraw any asset at any time, without delay or governance. The keeper cannot — it is restricted to approved venues and to distributions. This is the protocol's principal risk and the contract does not mitigate it.",
  },
  {
    question: "Has the protocol been audited?",
    answer:
      "No external audit has been completed. The contracts carry a test suite, which is not a substitute for review, and nothing is deployed. Any audit will be published here with its findings, resolved or otherwise.",
  },
  {
    question: "Is the protocol live?",
    answer:
      "Not yet. The vault contract is complete and tested; the execution layer that opens and manages positions is not built, and nothing is deployed. The positions page displays example data, labelled as such.",
  },
  {
    question: "Why not just pick the pool with the biggest fees?",
    answer:
      "Because fee income is only one side. When the price moves, a position ends up holding more of whichever asset fell, and that cost can exceed the fees entirely. Resident prices both before opening.",
  },
  {
    question: "Why a narrow range instead of a safe wide one?",
    answer:
      "Width is paid for in income. Capital spread across prices where nothing trades earns proportionally less of the flow. Narrow earns more and leaves range sooner, so width is set from each pool's measured volatility rather than chosen for comfort.",
  },
  {
    question: "What happens if it loses money?",
    answer:
      "Losses are absorbed by the retained 85%. Profit already credited to holders is never reversed, though accrual pauses until the loss is recovered and distributions go quiet in the interim. Positions that move against the protocol are held and re-centred rather than sold into thin liquidity.",
  },
  {
    question: "Is there anything to stake or claim?",
    answer:
      "No. Balances are read from the token and distributions are pushed to holders. Nothing is locked, nothing is signed, and accrued profit does not expire.",
  },
  {
    question: "Do the figures on this site represent returns?",
    answer:
      "No. They are projections modelled at full capture, which assumes all pool volume transacts through the position's range. Measured against route-level simulation, realised capture was materially lower. Nothing is deployed, so there are no realised returns to report.",
  },
] as const;

export const DOCS_BLURB =
  "Every value on this page is read from the code the protocol runs.";

export const TAGLINE = "The resident market maker for tokenized equities";
