/**
 * Landing page copy. Four sections; the full method lives at /docs.
 *
 * Register: a liquidity protocol describing itself plainly — mechanism first,
 * precise numbers, no hype. What that register must not do is borrow the claims
 * that usually travel with it: Resident is not non-custodial, not audited, not
 * governed and not deployed, so none of those words appear anywhere on the
 * page. The FAQ here is technical only; custody and deployment status are
 * stated at /docs, which every section links to.
 *
 * On the 85/15 split: the 85% is protocol working capital, not a holder claim
 * held back. It is deployed, it absorbs losses, and the owner key can withdraw
 * it. Copy that lets a reader think of it as "their other 85%" would be false,
 * so the page says whose it is every time it names the number.
 */

export const TOKEN = "$RES";

export const HERO = {
  headline: "The liquidity layer for tokenized equities.",
  sub: "Tokenized equity markets are thin enough that a five-figure order moves the price. Resident is the capital on the other side of that trade, across Robinhood Chain and Solana. Trading fees on $RES fund every position, and 15% of realized profit goes to holders in USDG every 15 minutes.",
  cta: "Get $RES",
  secondary: "Read the docs",
};

export const HERO_STATS = [
  { value: "15%", label: "of realized profit to holders" },
  { value: "15 min", label: "distribution interval" },
  { value: "USDG", label: "distribution asset" },
];

export const STEPS_HEADING =
  "$RES funds the positions. The positions pay $RES holders.";

export const STEPS = [
  {
    n: "01",
    title: "Capitalization",
    body: "Trading fees on $RES accrue to the vault, and they are the only capital the protocol ever deploys. There is no raise, no treasury and no outside investor, so capacity is set by the token's own turnover and by nothing else.",
  },
  {
    n: "02",
    title: "Liquidity provision",
    body: "That capital is placed as concentrated liquidity in the pools worth being in: thin enough that a five-figure position takes a real share of the flow, busy enough to pay continuously, and holding a range rather than falling through one.",
  },
  {
    n: "03",
    title: "Position management",
    body: "A position earns only while price trades inside its range, so ranges are re-centered as markets move and retired when a pool stops paying for itself. Positions that move against the protocol are re-centered rather than sold into thin liquidity.",
  },
];

export const EDGE_HEADING = "Three things this does differently.";

export const EDGE = [
  {
    label: "Net, not yield",
    body: "Every liquidity dashboard publishes fee income. Fees are the flattering half: a position can collect handsomely while the price move underneath it costs more than the fees bring in. Resident publishes fees less what the price move cost, over the same window, including when that number is negative.",
  },
  {
    label: "Two chains, one ranking",
    body: "A concentrated range on Robinhood Chain and a discrete-bin position on Solana earn in completely different ways, so ranking them on headline yield compares two numbers that do not mean the same thing. Both are priced into one figure that does, and capital only crosses when the edge covers the round trip.",
  },
  {
    label: "Every threshold published",
    body: "The conditions a pool has to clear, the width a position is given, the point at which it is retired: all of it is stated with its value in the docs, read from the code the protocol runs. Changing one is visible as a change.",
  },
] as const;

export const PAYOUT = {
  headline: "Distributions",
  body: "Realized profit is split at a fixed ratio enforced by the contract. 15% accrues to $RES holders and is distributed pro-rata in USDG every 15 minutes. The remaining 85% is retained as working capital: it funds new positions and absorbs losses, and holders have no claim on it.",
  points: [
    {
      label: "Pro-rata",
      body: "Distributed by balance across an eligibility-filtered holder snapshot.",
    },
    {
      label: "No staking",
      body: "Balances are read from the token. Nothing is deposited or locked.",
    },
    {
      label: "Push-based",
      body: "Distributions are sent to holders. There is no claim transaction.",
    },
    {
      label: "Carries forward",
      body: "Accrued profit persists in the ledger until it is paid. Distributions run once $300 is owed in total, and the balance never resets.",
    },
  ],
};

export const FAQ_HEADING = "FAQ";

/**
 * Technical questions only — how a position works, how pools are chosen, what
 * happens when price moves. Custody, audit status and deployment status are
 * deliberately not here; they live in the Custody section and the invariants
 * table at /docs, which this section links to.
 */
export const FAQS = [
  {
    q: "What is a concentrated position?",
    a: "Capital committed between two prices rather than spread across every price. While the market trades inside that range, the position earns a share of every fee paid. Outside it, the position holds inventory and earns nothing. A narrower range takes a larger share of the flow and spends more time out of it.",
  },
  {
    q: "How are pools chosen?",
    a: "Seven conditions, all of which must hold. The pool can be priced in dollars, which for a WETH-quoted pool means converting at what ether is trading at in its own market. The fee the pool charges reaches the position, read live from the pool rather than assumed from the tier it was created with. At least $25,000 of volume in the trailing hour. No more than $400,000 of liquidity within 5% of the price. Trading at 60% or more of its 24-hour high. At least 20 minutes old. And the providers already in that pool are net winners rather than net losers.",
  },
  {
    q: "How wide is a position?",
    a: "Width is derived from each pool's own measured volatility rather than fixed: 1.25 standard deviations over a four-hour horizon, bounded at 1% and 60%. A volatile pool receives a wider range and a smaller share of flow by construction. At that width a position sits in range roughly 91% of the time. Buying the last few points of coverage costs about half the income.",
  },
  {
    q: "Why not just open in the highest-fee pool?",
    a: "Because fee income is only one side of the ledger. A pool paying 3% a day into a book that moves 20% a day loses money, and a ranking built on fees recommends it every time. A position is opened only when expected fee income exceeds the expected cost of the price moving, measured at that pool's own volatility.",
  },
];

export const FOOTER_NOTE =
  "Tokenized equity markets are volatile and thinly traded. Holding $RES carries risk of loss, including total loss. Nothing on this page is financial advice.";

export const TAGLINE = "The resident market maker for tokenized equities";
