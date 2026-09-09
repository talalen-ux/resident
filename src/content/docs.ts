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
export const QUOTE = "USDG and WETH";

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
  { step: "The vault", note: "One address holds every asset" },
  { step: "Selection", note: "Six conditions, all of which must hold" },
  { step: "Range", note: "Tight for calm pools, wide for volatile ones" },
  {
    step: "Entry test",
    note: "Opened only if fees are expected to beat the price move",
  },
  {
    step: "Management",
    note: "Re-centred when the price leaves the range",
  },
  {
    step: "Realized profit",
    note: "Fees collected, less what the price move cost",
  },
] as const;

export const METHOD = [
  {
    n: "01",
    id: "overview",
    title: "Protocol overview",
    body: [
      "Every swap trades against a pool of capital that someone committed. Whoever committed it receives a share of the fee on every trade that uses it. Resident is that capital, and that share is what it earns.",
      "Liquidity does not have to cover every price. A position can be committed to a single band, say between $9 and $11. Inside that band it takes a much larger share of the trades, because the capital is concentrated where the trading happens. Outside it, the position earns nothing and holds whatever the pool left it with.",
      "The protocol does three things: select pools worth being in, size a range the price will hold inside, and close a position once it no longer earns its keep.",
    ],
    pull: "This is not a position on price. It is rent, paid for making a market other people trade in.",
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
      "Seven conditions, evaluated continuously. All seven must hold; a pool that fails any one is not a candidate at any size.",
      "The pool can be priced in dollars. Pools are quoted in USDG or in WETH, and every threshold below is a dollar figure, so a WETH pool is converted at the rate its own market against USDG is trading at. A quote the protocol cannot price is held rather than measured in the wrong unit, because eight ether an hour of volume looks like nothing against a $25,000 threshold and a hundred ether of depth looks like nothing against a $400,000 cap. The fee the pool charges reaches the position. The protocol reads the fee being charged now rather than the tier the pool was created with, so a pool that has quietly stopped paying its providers fails here. At least $25,000 has traded in it in the last hour, because a quiet pool pays nothing. No more than $400,000 of liquidity sits near the current price, because the more crowded a pool is, the smaller the share. The price is still within 40% of its 24-hour high, so the protocol is not providing liquidity into a fall. The pool is at least 20 minutes old, which excludes the first minutes of a launch. And the providers already in it are making money rather than losing it.",
      "These are Uniswap v4 pools. Many of the best of them charge a dynamic fee that rises when the market is busy, and a dynamic fee is implemented with a hook. A rule that avoided hooks would therefore avoid the pools worth being in. What matters is not whether a pool has custom code attached, but whether the fee it charges still arrives, which is read from the pool directly.",
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
      "When the price moves while capital sits in a range, the position ends up holding more of whichever asset fell and less of the one that rose. That is a worse outcome than holding both and doing nothing, and the cost scales with how far the price travels.",
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
      "A position closes when net earnings fall 35% below the capital committed, where net means fees collected less the cost of price movement. A pool that stays unprofitable is dropped rather than re-centred, because what has changed is the pool and not the position.",
      "Positions that move against the protocol are held and re-centred rather than sold into thin liquidity, which usually deepens the loss. The trade-off is that capital can remain committed to a weak market for an extended period.",
    ],
  },
  {
    n: "07",
    id: "execution",
    title: "Execution",
    body: [
      "Choosing a position and taking one are different problems. A process reads the chains on a fixed interval, prices every pool it watches, decides, and writes down what it is about to do before it does it. If it stops halfway through, it restarts knowing there is a transaction it cannot account for, and it checks the chain rather than assuming either way. That is what prevents the same position being opened twice.",
      "Each interval runs the same rules in the same order. Close anything that has stopped earning; collect fees that are worth collecting; re-centre anything that has drifted off the price; put idle money to work in the best pool that qualifies; and only then consider moving money to another chain, which is the one decision that cannot be undone within the interval.",
      "Fees are collected once they reach $100, or after 15 minutes, whichever comes first. They are never collected when the amount would not cover several times the cost of collecting it, so a pool that has gone quiet stops being swept rather than being drained a few dollars at a time.",
      "The process cannot change anything about the vault. It can move money between venues; it cannot change which venues exist, raise the payout cap, or allow a new bridge. It refuses to start if the key it has been given is the one that could.",
    ],
    pull: "Nothing is remembered that was not written down first.",
  },
  {
    n: "08",
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
    n: "09",
    id: "reporting",
    title: "What gets reported",
    body: [
      "Almost every liquidity dashboard shows fees earned. Fees are the flattering half of the number: a position can be collecting handsomely while the money underneath it loses more than the fees bring in, and a page that shows fees alone will show that position as a winner for as long as it keeps losing.",
      "Resident reports net over the same window, meaning fees less what the price move cost the capital committed, and reports it when it is negative. Both halves are shown alongside it, so the arithmetic is visible rather than asserted.",
      "Positions are kept in a ledger that nothing leaves. What a closed position made is arithmetic on amounts that went in and came out, with the transactions listed; what an open one is worth is marked and reported separately, never added to the closed figure. Adding the two produces something that moves with the market and reads like a bank balance.",
      "Where a figure has not been measured, the page says so instead of showing a zero. A pool with no comparable market elsewhere has no reference price, and a position without enough history has no six-hour net.",
    ],
  },
  {
    n: "10",
    id: "limits",
    title: "Status and limitations",
    body: [
      "Resident is pre-deployment. The vault contract is complete and covered by a test suite; it has not been externally audited and is not deployed. No vault holds assets, and the positions page displays example data, labelled as such.",
      "The process described above runs, and it signs nothing. It reads chains, ranks pools, and records every position it would have opened. That record is worth having on its own, because it can be checked against what those pools actually paid before any capital is at risk. Two things stand between it and taking a position: a signing service, which does not belong in this code, and the venue-specific component that knows how to open a position on each venue.",
      "Fee projections are modelled at full capture: they assume all pool volume transacts through the position's range. Measured against route-level simulation, realised capture was materially lower. Every projection on this site is an upper bound.",
    ],
  },
] as const;

export const LP_BANDS = [
  {
    mode: "standard",
    label: "Two-sided range",
    summary:
      "Capital on both sides of the current price, so the position earns whether price moves up or down. Width is set by the pool's own volatility.",
    range: "a band around the current price",
    lifecycle: [
      "Price leaves the range and stays out → the position is re-centred.",
      "Net earnings fall 35% below the capital committed → the position is closed.",
      "The pool stays unprofitable for long enough → dropped rather than re-centred.",
    ],
  },
  {
    mode: "single-sided",
    label: "Bid-side range",
    summary:
      "Placed entirely below the current price, so it fills only if the price comes down to it. Used where the protocol would rather acquire the token at a level it selected than hold it on both sides.",
    range: "entirely below the current price",
    lifecycle: [
      "The price falls through it → the protocol holds the token, at the level it selected.",
      "The price runs away upward → nothing fills, and the position is closed and re-placed higher.",
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
    read: "The board ranks candidates. It does not open positions, and every entry still has to clear the net test.",
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
    body: "Fees collected less the cost of price movement. Monotonic: it only increases.",
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
    invariant: "Every asset sits at one address",
    mechanism:
      "Positions, cash and incoming fees are all held by the vault. The keeper's own wallet holds gas and nothing else",
  },
  {
    invariant: "The keeper can only reach approved venues",
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
      "The total can only increase, so a report cannot be retracted to strand holders",
  },
  {
    invariant: "Only 15% can ever be paid out",
    mechanism:
      "The contract tracks the holder share separately and will not pay beyond it",
  },
  {
    invariant: "A loss cannot reduce what is already owed",
    mechanism:
      "Absorbing a loss reduces the 85% and pauses new accrual. It never reduces what holders are already owed",
  },
  {
    invariant: "Payouts are capped per day",
    mechanism: "A rolling 24-hour limit per asset, enforced by the contract",
  },
  {
    invariant: "The keeper can be replaced in one transaction",
    mechanism: "One transaction swaps it out, and no asset moves",
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
  { meaning: "Narrowest and widest it can go", value: "1% to 60%" },
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
  { meaning: "Fees are collected once they reach", value: "$100" },
  { meaning: "Or after this long uncollected", value: "15 minutes" },
  { meaning: "Readings under the floor before a position is retired", value: "10" },
  { meaning: "Held back so the protocol can always pay for gas", value: "$250" },
  { meaning: "Smallest position on a small-cap pool", value: "$250" },
  { meaning: "Widest a Solana position is spread", value: "69 bins" },
  { meaning: "A cross-chain edge is assumed to last", value: "12 hours" },
  { meaning: "A cross-chain move must be worth", value: "1.5x its cost" },
  { meaning: "Smallest amount worth moving between chains", value: "$2,500" },
  { meaning: "Re-centring must be worth", value: "2x its cost" },
  { meaning: "A pool counts as ranging if it held", value: "±35%" },
  { meaning: "for at least this much of its history", value: "80%" },
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
      "The deploying wallet can withdraw any asset at any time, without delay or governance. The keeper cannot: it is restricted to approved venues and to distributions. This is the protocol's principal risk, and the contract does not mitigate it.",
  },
  {
    question: "Has the protocol been audited?",
    answer:
      "No external audit has been completed. The contracts carry a test suite, which is not a substitute for review, and nothing is deployed. Any audit will be published here with its findings, resolved or otherwise.",
  },
  {
    question: "Is the protocol live?",
    answer:
      "Not yet. The vault contract is complete and tested, and the process that reads the chains and decides what to open runs, but it signs nothing and nothing is deployed. The positions page displays example data, labelled as such.",
  },
  {
    question: "Why not just pick the pool with the biggest fees?",
    answer:
      "Because fee income is only one side. When the price moves, a position ends up holding more of whichever asset fell, and that cost can exceed the fees entirely. Resident prices both before opening.",
  },
] as const;

export const DOCS_BLURB =
  "Every value on this page is read from the code the protocol runs.";

export const TAGLINE = "The resident market maker for tokenized equities";
