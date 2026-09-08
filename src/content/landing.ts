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
  headline: "A liquidity protocol for tokenized equities.",
  sub: "Resident provides concentrated liquidity in tokenized equity markets on Robinhood Chain. Trading fees on $RES capitalize the protocol's positions. 15% of realized profit is distributed to holders every 15 minutes; the remaining 85% is redeployed as working capital.",
  cta: "Get $RES",
  secondary: "Read the docs",
};

export const HERO_STATS = [
  { value: "15%", label: "of realized profit to holders" },
  { value: "15 min", label: "distribution interval" },
  { value: "USDG", label: "distribution asset" },
];

export const STEPS_HEADING =
  "Fee income capitalizes the protocol. The protocol provides liquidity where fee income is highest.";

export const STEPS = [
  {
    n: "01",
    title: "Capitalization",
    body: "Trading fees on $RES accrue to the protocol vault, which is the sole source of capital for its positions. Nothing is raised externally and nothing is held aside as treasury.",
  },
  {
    n: "02",
    title: "Liquidity provision",
    body: "Capital is deployed as concentrated liquidity in tokenized equity pools selected on depth and turnover — markets thin enough that a five-figure order moves the price, and active enough to generate continuous fee income.",
  },
  {
    n: "03",
    title: "Position management",
    body: "A concentrated position earns only while price trades inside its range, so positions are re-centered as markets move. Positions that move against the protocol are held and re-centered rather than realized into thin books.",
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
      body: "Accrued profit persists in the ledger until paid, above a $300 threshold. It does not reset.",
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
    a: "Capital committed between two prices rather than spread across every price. While the market trades inside that range the position earns a share of every fee paid; outside it, the position holds inventory and earns nothing. Narrower means a bigger share of the flow and more time spent out of range.",
  },
  {
    q: "How are pools chosen?",
    a: "Six gates, all of which must pass: no v4 hook and a real LP fee, at least $25,000 of volume in the trailing hour, no more than $400,000 of liquidity within ±5% of price, trading at 60% or more of the 24-hour peak, at least 20 minutes old, and the smart-LP tracker showing net winners among the providers already there.",
  },
  {
    q: "How wide is a position?",
    a: "Width comes from the pool's own realised volatility, not a constant — 1.25σ over a four-hour horizon, clamped between 1% and 60%. A volatile pool gets a wider band and a smaller share of flow by construction. At 1.25σ a position sits in range about 91% of the time; buying the last few points costs roughly half the income.",
  },
  {
    q: "Why not just open in the highest-fee pool?",
    a: "Because fee income is only one side. A pool paying 3% a day into a book that moves 20% a day loses money, and a fee ranking recommends it every time. A position is opened only when expected fee income beats expected divergence loss at that pool's volatility.",
  },
  {
    q: "What happens when price leaves the range?",
    a: "Nothing immediately — one tick through the edge is not a signal. After five intervals outside its bounds the position is re-centred on the new price. A pool whose net rate stays negative for 120 intervals is abandoned rather than re-centred, because the pool has changed, not the position.",
  },
  {
    q: "What happens when a position loses money?",
    a: "The loss is absorbed by the retained 85%. Profit already accrued to holders is never reversed, but accrual pauses until the loss is earned back. Positions are held and re-centred rather than closed into thin books, so capital can sit in a losing name for a while.",
  },
  {
    q: "Where does the capital come from?",
    a: "Trading fees on $RES, and nothing else. There is no external raise and no treasury held aside, which means the protocol's capacity to earn is bounded by its own token's turnover.",
  },
  {
    q: "Are the fee figures achieved returns?",
    a: "No. They are estimates at capture efficiency 1, which credits a position with every fee paid at every price it covers — an upper bound. Measured against a route-level simulation the realised figure came in well below it. Read every projected fee number as a ceiling.",
  },
];

export const FOOTER_NOTE =
  "Tokenized equity markets are volatile and thinly traded. Holding $RES carries risk of loss, including total loss. Nothing on this page is financial advice.";

export const TAGLINE = "The resident market maker for tokenized equities";
