/**
 * Landing page copy. Four sections; the full method lives at /docs.
 *
 * Register: short sentences, the number before the explanation. This is a page
 * someone reads standing up, deciding in thirty seconds whether to care — not a
 * paper they sit down with. An earlier draft ran 40-word single sentences and a
 * 102-word FAQ answer, which is how a method note reads, not a product.
 *
 * Plain does not mean loose. Every figure here is the one the code runs, and
 * the claims that usually travel with this register are the ones Resident
 * cannot make: not non-custodial, not audited, not governed, not deployed. None
 * of those words appear on the page. Being punchier must never become a way to
 * imply them. The FAQ is technical only; custody and deployment status are
 * stated at /docs, which every section links to.
 *
 * On the 85/15 split: the 85% is protocol working capital, not a holder claim
 * held back. It is deployed, it absorbs losses, and the owner key can withdraw
 * it. Copy that lets a reader think of it as "their other 85%" would be false,
 * so the page says whose it is every time it names the number.
 */

export const TOKEN = "$RES";

export const HERO = {
  headline: "$RES buys liquidity. The liquidity pays holders.",
  sub: "Tokenized equity markets are thin. A five-figure order moves the price. Resident is the capital on the other side of that trade, on Robinhood Chain and Solana. Trading fees on $RES fund every position. 15% of realized profit goes to holders in USDG.",
  cta: "Get $RES",
  secondary: "Read the docs",
};

export const HERO_STATS = [
  { value: "15%", label: "of realized profit to holders" },
  { value: "USDG", label: "paid in stablecoin" },
  { value: "0", label: "claim transactions" },
];

export const STEPS_HEADING =
  "$RES funds the positions. The positions pay $RES holders.";

export const STEPS = [
  {
    n: "01",
    title: "Fees in",
    body: "Trading fees on $RES go to the vault. That is the only capital the protocol ever deploys. No raise, no treasury, no investors. Capacity is set by the token's own turnover.",
  },
  {
    n: "02",
    title: "Capital out",
    body: "It goes into concentrated positions in pools worth being in. Thin enough that five figures takes real share of the flow. Busy enough to pay continuously. Holding a range instead of falling through one.",
  },
  {
    n: "03",
    title: "Positions tended",
    body: "A position earns only while price sits inside its range. Ranges are re-centered as markets move, and retired when a pool stops paying for itself. A position that moves against us gets re-centered, not dumped into thin liquidity.",
  },
];

export const EDGE_HEADING = "Four things we do differently.";

export const EDGE = [
  {
    label: "Net, not yield",
    body: "Every liquidity dashboard publishes fee income. Fees are the flattering half. A position can collect handsomely while the price move underneath costs more than it brings in. We publish fees less what the move cost, over the same window. Including when that number is negative.",
  },
  {
    label: "Capital follows the fees",
    body: "A position can be healthy and still be in the wrong pool: nothing wrong with it, earning a fraction of what is available elsewhere. That never looks like a loss, so most desks leave it. We check every position against the board each interval. Capital moves when the gap clears three times the round trip.",
  },
  {
    label: "Two chains, one ranking",
    body: "A range on Robinhood Chain and a bin on Solana earn in completely different ways. Ranking them on headline yield compares two numbers that do not mean the same thing. Both get priced into one that does. Capital only crosses when the edge covers the trip.",
  },
  {
    label: "Every threshold published",
    body: "What a pool has to clear. How wide a position gets. When it is retired. Every number is in the docs, read from the code that runs. Change one and it shows as a change.",
  },
] as const;

export const PAYOUT = {
  headline: "Distributions",
  body: "Realized profit splits at a fixed ratio the contract enforces. 15% to $RES holders, pro-rata in USDG. The other 85% stays as working capital: it funds new positions and absorbs losses. Holders have no claim on it.",
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
      body: "Accrued profit persists in the ledger until it is paid. A distribution runs once every holder is owed at least $5, so nothing is spent sending amounts smaller than the cost of sending them.",
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
    a: "Capital committed between two prices instead of spread across all of them. Inside that range, the position earns a share of every fee paid. Outside it, it holds inventory and earns nothing. Narrower takes more of the flow and spends more time out of range.",
  },
  {
    q: "How are pools chosen?",
    a: "Seven conditions, all of them. The pool prices in dollars. The fee it charges actually reaches the position, read live rather than assumed from its tier. $25,000 of volume in the last hour. No more than $400,000 of liquidity within 5% of price. Trading at 60% or more of its 24-hour high. At least 20 minutes old. And the providers already in it are net winners.",
  },
  {
    q: "How wide is a position?",
    a: "Not fixed. It comes from each pool's own measured volatility: 1.25 standard deviations over four hours, bounded at 1% and 60%. A volatile pool gets a wider range and a smaller share of flow. At that width a position is in range about 91% of the time. Buying the last few points of coverage costs about half the income.",
  },
  {
    q: "Why not just open in the highest-fee pool?",
    a: "Fee income is one side of the ledger. A pool paying 3% a day into a book that moves 20% a day loses money, and a ranking built on fees recommends it every time. We open only when expected fees beat the expected cost of the price moving. Measured at that pool's own volatility, not a house average.",
  },
];

export const FOOTER_NOTE =
  "Tokenized equity markets are volatile and thinly traded. Holding $RES carries risk of loss, including total loss. Nothing on this page is financial advice.";

export const TAGLINE = "The resident market maker for tokenized equities";
