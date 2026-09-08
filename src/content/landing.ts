/**
 * Landing page copy. Four sections; the full method lives at /docs.
 *
 * Register: a liquidity protocol describing itself plainly — mechanism first,
 * precise numbers, no hype. What that register must not do here is borrow the
 * claims that usually travel with it. Resident is not non-custodial, not
 * audited, not governed and not deployed, so none of those words appear, and
 * the security section states each absence directly rather than leaving a
 * confident tone to imply otherwise.
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

export const FAQ_HEADING = "Security and risk";

/**
 * The disclosures a reader should have before buying, in the order they matter.
 * Custody leads because it is the largest, and it is stated as the protocol's
 * own limitation rather than framed as a general market caveat.
 */
export const FAQS = [
  {
    q: "Who controls the vault?",
    a: "The vault owner — the deployer wallet — can withdraw any asset at any time, with no timelock and no governance process. The keeper cannot: it is restricted to allowlisted venues and to distributions. This is the protocol's principal risk, it is not mitigated by the contract, and it means Resident is not non-custodial and should not be described as such.",
  },
  {
    q: "Has the protocol been audited?",
    a: "No. The contracts are covered by a test suite but have not been reviewed by a third party, and nothing has been deployed to mainnet. Any audit will be published here with its findings, resolved or otherwise.",
  },
  {
    q: "How is realized profit determined?",
    a: "It is reported to the vault by the keeper. Profit on an arbitrary venue cannot be derived on-chain without trusting the same quote the keeper used, so the contract does not verify the figure. What it does enforce: reported totals only increase, only 15% is ever payable, and distributions can never exceed what is owed or what the vault holds. A dishonest keeper could under-report; it could not over-pay, retract a report, or move funds outside the allowlist.",
  },
  {
    q: "Why is 85% retained rather than distributed?",
    a: "Retained capital is what generates the fee income. A protocol that distributes everything cannot grow its position base, and distributions shrink with it. The retained share is working capital, not a deferred holder claim — it absorbs losses first, and holders have no claim on it.",
  },
  {
    q: "What happens when a position loses money?",
    a: "The loss is absorbed by retained working capital. Profit already accrued to holders is never reversed, but accrual pauses until the loss is recovered, and a smaller capital base earns proportionally less afterwards.",
  },
  {
    q: "What happens in a period with no fee income?",
    a: "There is no distribution. Distributions are funded exclusively by realized profit; the protocol does not distribute principal and does not accrue a yield it has not earned.",
  },
];

export const FOOTER_NOTE =
  "Tokenized equity markets are volatile and thinly traded. Holding $RES carries risk of loss, including total loss. Nothing on this page is financial advice.";

export const TAGLINE = "The resident market maker for tokenized equities";
