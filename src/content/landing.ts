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
  sub: "Concentrated liquidity, priced and placed where fee income exceeds the cost of holding it, across Robinhood Chain and Solana. Trading fees on $RES capitalize every position. Holders receive 15% of realized profit every 15 minutes, in USDG.",
  cta: "Get $RES",
  secondary: "Read the docs",
};

export const HERO_STATS = [
  { value: "15%", label: "of realized profit to holders" },
  { value: "15 min", label: "distribution interval" },
  { value: "USDG", label: "distribution asset" },
];

export const STEPS_HEADING =
  "Fee income capitalizes the protocol. The protocol provides liquidity where fee income exceeds the cost of holding it.";

export const STEPS = [
  {
    n: "01",
    title: "Capitalization",
    body: "Trading fees on $RES accrue to the protocol vault, which is the sole source of capital for its positions. Nothing is raised externally and nothing is held aside as treasury.",
  },
  {
    n: "02",
    title: "Liquidity provision",
    body: "Capital is deployed as concentrated liquidity in tokenized equity pools selected on depth and turnover. The protocol targets markets thin enough that a five-figure order moves the price, and active enough to pay continuous fee income.",
  },
  {
    n: "03",
    title: "Position management",
    body: "A concentrated position earns only while price trades inside its range, so positions are re-centered as markets move. Positions that move against the protocol are held and re-centered rather than sold into thin liquidity.",
  },
];

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
    a: "Six conditions, all of which must hold. The fee the pool charges reaches the position, read live from the pool rather than assumed from the tier it was created with. At least $25,000 of volume in the trailing hour. No more than $400,000 of liquidity within 5% of the price. Trading at 60% or more of its 24-hour high. At least 20 minutes old. And the providers already in that pool are net winners rather than net losers.",
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
