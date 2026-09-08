/**
 * Docs copy.
 *
 * Every number here is read from the code it describes, not chosen to read
 * well: the gate thresholds are DEFAULT_ALERT_CONFIG in src/lib/sim/opportunity.ts,
 * the width and entry policy is DEFAULT_WIDTH_CONFIG / DEFAULT_ENTRY_CONFIG and
 * the exits DEFAULT_EXIT_CONFIG in src/lib/sim/strategy.ts, and the ledger is
 * HOLDER_BPS and the accessors in contracts/ResidentVault.sol. If one of those
 * changes and this file does not, the docs are wrong — that is the intended
 * failure mode, and it is why the values are quoted rather than paraphrased.
 *
 * The register is a protocol documenting itself. It does not borrow the claims
 * that usually travel with that register: nothing here is described as
 * non-custodial, audited, governed or live, because none of it is.
 */

export const TOKEN = "$RES";
export const CHAIN = "Robinhood Chain";
export const QUOTE = "USDG";

export const NAV_LINKS = [
  { label: "Overview", href: "#overview" },
  { label: "Capital", href: "#capital" },
  { label: "Selection", href: "#selection" },
  { label: "Width", href: "#width" },
  { label: "Entry", href: "#entry" },
  { label: "Management", href: "#management" },
  { label: "Accounting", href: "#accounting" },
  { label: "Custody", href: "#custody" },
  { label: "Parameters", href: "#parameters" },
] as const;

export const HERO_HEADLINE =
  "Concentrated liquidity in tokenized equity pools, sized so that fees outrun the bleed.";

export const HERO_STANDFIRST =
  "Resident deploys capital as concentrated liquidity in thin, high-turnover tokenized equity pools on Robinhood Chain. Trading fees on $RES capitalize the positions. 15% of realized profit is distributed to holders every 15 minutes; 85% is retained as working capital.";

export const HERO_NOTE =
  "This page states the policy, including the parts that are unfavourable. Every threshold below is the value the code actually runs with.";

export const PILLARS = [
  {
    icon: "reference" as const,
    eyebrow: "Width from volatility",
    body: "Band width is set from the pool's own realised volatility, so time in range is a target rather than a side effect of a constant.",
  },
  {
    icon: "probe" as const,
    eyebrow: "Entry on net, not headline",
    body: "A position is opened only when expected fee income exceeds expected divergence loss at that volatility. A large fee number is not a reason.",
  },
  {
    icon: "payout" as const,
    eyebrow: "15% to holders",
    body: "15% of realized profit accrues to holders and carries forward. It never resets, and it pays every 15 minutes.",
  },
] as const;

/** The capital cycle. Fee flow only becomes a distribution by passing every stage. */
export const CYCLE = [
  { step: "Token fees", note: "Trading fees on $RES accrue to the vault" },
  {
    step: "Vault",
    note: "One address holds every balance; the keeper holds gas",
  },
  { step: "Selection", note: "Six gates, re-evaluated continuously" },
  { step: "Width", note: "1.25σ over a 240-interval horizon" },
  { step: "Entry test", note: "Open only if fee rate exceeds bleed rate" },
  { step: "Management", note: "Re-centre after 5 intervals out of range" },
  {
    step: "Realized profit",
    note: "Fees collected, less divergence loss taken",
  },
] as const;

export const METHOD = [
  {
    n: "01",
    id: "overview",
    title: "What the protocol does",
    body: [
      "A concentrated liquidity position is capital committed between two prices. While the market trades inside that range the position earns a share of every fee paid; outside it, the position holds inventory and earns nothing. The narrower the range, the larger the share of flow — and the more often price leaves it.",
      "Tokenized equity pools on Robinhood Chain are thin and, in a subset of names, busy. Thin means a five-figure order visibly moves the price, so a modest position takes a large share of the flow. Busy means that flow keeps arriving. Those two conditions together are the only place this strategy pays, and most pools have one without the other.",
      "The protocol's entire job is deciding which pools have both, how wide to sit, and when the position has stopped being worth holding.",
    ],
    pull: "Being paid to hold a range is not the same as being paid to be right about price. The position is the fee capture; the inventory is the cost of it.",
  },
  {
    n: "02",
    id: "capital",
    title: "Where the capital comes from",
    body: [
      "Trading fees on the $RES token accrue to the protocol vault. That is the sole source of capital for positions: nothing is raised externally, and no balance is held aside as treasury.",
      "The consequence is worth stating plainly rather than leaving to be inferred. The protocol's capacity to earn is bounded by its own token's turnover, and a quiet market for $RES means a smaller position base, which means smaller distributions. The two are coupled by design and there is no mechanism that decouples them.",
    ],
  },
  {
    n: "03",
    id: "selection",
    title: "Pool selection",
    body: [
      "Pools are evaluated continuously against six gates. All six must pass; a pool that fails any one is not a candidate at any size.",
      "Hook-free with a real LP fee — a Uniswap v4 hook can take the LP's fee before it reaches the position, so a pool running one is excluded regardless of how it prices. At least $25,000 of volume in the trailing hour, because a wide range on a dead pool earns nothing and still bleeds. Liquidity within ±5% of price at or below $400,000, which is what makes a $10,000 band a meaningful share rather than a rounding error. Trading at 60% or more of its 24-hour peak, so the protocol is not providing the exit for a collapse. At least 20 minutes old, which discards the launch minute. And the smart-LP tracker showing net winners among the liquidity providers already there.",
      "A pool that stops qualifying fades from the board rather than vanishing and stays for 24 hours, so a spike that has already passed is still readable rather than silently erased.",
    ],
    formula: {
      expr: "share  =  L_band / ( L_band + L_pool )",
      caption:
        "Share of in-range flow, compared as liquidity L rather than as dollar amounts — see Entry",
    },
  },
  {
    n: "04",
    id: "width",
    title: "How wide the band sits",
    body: [
      "Width is derived from the pool's realised volatility rather than fixed. A band expected to hold for a given horizon must widen with the square root of that horizon, so the same capital in a volatile pool sits wider and takes a smaller share by construction.",
      "The sigma multiple is calibrated by measurement, not derived. At a volatility of 0.004 over a 240-interval horizon, the fraction of time a random walk spends inside the band runs 83.0% at 1.00σ, 90.8% at 1.25σ, 95.6% at 1.50σ, 99.2% at 2.00σ and 99.8% at 2.50σ.",
      "Because share is density-weighted, roughly halving the width doubles the fee share — so the last few points of time-in-range are expensive. Moving from 1.25σ to 2.50σ buys nine points of time in range and gives up about half the income to do it. The protocol runs 1.25σ for that reason, clamped to a half-width between 1% and 60%.",
    ],
    formula: {
      expr: "w  =  σ · k · √h ,    k = 1.25 ,  h = 240",
      caption:
        "Half-width for a band expected to hold h minute-intervals at volatility σ",
    },
  },
  {
    n: "05",
    id: "entry",
    title: "The entry test",
    body: [
      "A position is opened only when expected fee income exceeds expected divergence loss at that pool's own volatility. This is the whole decision, and it is deliberately not the one a fee-ranked board makes: a pool paying 3% a day into a book that moves 20% a day is a losing position however good the headline looks, and it is precisely the position a fee ranking recommends.",
      "Share is computed by comparing liquidity values, not dollar amounts. The naive form — capital divided by capital plus pool liquidity — makes band width free, which it is not: the same capital spread over ±20% has a quarter the liquidity density of ±5% and earns proportionally less of the flow crossing any given price. Comparing actual L prices that in, so widening for safety costs income, which is the real trade.",
      "Divergence loss is evaluated with the exact position algebra at a one-sigma move in each direction and averaged, rather than with the quadratic impermanent-loss approximation — the loss is symmetric in log price, not in price.",
    ],
    formula: {
      expr: "net  =  volume · f · share · η  /  capital   −   bleed(w, σ)",
      caption:
        "Open when net > 0. η is capture efficiency, currently 1 — an upper bound, not a fitted value",
    },
  },
  {
    n: "06",
    id: "management",
    title: "Managing an open position",
    body: [
      "A band out of range earns nothing, so a position is re-centred after five intervals outside its bounds rather than immediately — a single tick through the edge is not a signal.",
      "The stop is on net: fees already banked, less the bleed, falling 35% below the capital committed. A gross-drawdown stop throws away a position the fees have already paid for, which is the failure mode this is designed around. A pool whose net rate stays negative for 120 intervals is abandoned rather than re-centred, because the pool has changed, not the position.",
      "Positions that move against the protocol are held and re-centred rather than closed into thin books. That is a real choice with a real cost: it means capital can sit in a losing name for a long time, and the protocol carries that rather than realizing the loss to look clean.",
    ],
  },
  {
    n: "07",
    id: "accounting",
    title: "Profit and distribution",
    body: [
      "Realized profit is reported to the vault by the keeper. Profit on an arbitrary venue cannot be derived on-chain without trusting the same quote the keeper used, so the contract does not verify the figure. What it enforces is that the reported total only ever increases, that only 15% of any increase is ever payable, and that distributions can never exceed what is owed or what the vault actually holds.",
      "A dishonest keeper could therefore under-report profit. It could not pay out more than it reported, retract a report to strand holders, or move funds anywhere the venue allowlist does not already permit.",
      "Losses are absorbed by the retained 85%. Absorbing a loss stops further accrual until the desk has earned it back; it never claws back profit already credited to holders. Both figures are monotonic, so the balance owed is a function of them and of what has been distributed, and it carries forward rather than resetting.",
    ],
    formula: {
      expr: "O(t)  =  0.15 · Π(t)  −  D(t)",
      caption:
        "Owed to holders: 15% of lifetime realized profit, less what has been distributed",
    },
  },
  {
    n: "08",
    id: "limits",
    title: "What this does not establish",
    body: [
      "Capture efficiency is set to 1. The naive fee formula — volume times fee tier times share — is an upper bound, because it credits the position with every fee paid at every price it covers. Measured against a route-level simulation the realised figure came in far below that. Setting η to 1 states the bound rather than fitting a coefficient to two observations; every projected fee number on this site should be read as a ceiling.",
      "Nothing here has been deployed. The contracts carry a test suite and have not been audited, no vault exists on mainnet, and the positions dashboard is running on illustrative figures until one does. Pool selection additionally depends on per-pool volume windows and liquidity-provider event history, which an RPC alone cannot serve at usable speed — that indexer is an integration the protocol does not yet have.",
    ],
  },
] as const;

export const LP_BANDS = [
  {
    mode: "two-sided",
    label: "Centred, width from σ",
    summary:
      "The default. Centred on the pool price and funded on both sides, so it earns the pool fee on flow in either direction. Width comes from the pool's realised volatility rather than a constant, so a volatile pool gets a wider band and a smaller share of flow.",
    range: "[ P · (1 − w) ,  P · (1 + w) ] ,   w = 1.25σ√240",
    lifecycle: [
      "Price leaves the range and stays out for five intervals → re-centred on the new price.",
      "Net — fees banked less the bleed — falls 35% below capital committed → retired.",
      "Net rate stays negative for 120 intervals → the pool is abandoned rather than re-centred.",
    ],
  },
  {
    mode: "below",
    label: "Single-sided, quote only",
    summary:
      "Placed entirely below the pool price, so it fills only as price falls and never buys above spot. Used where the protocol wants the inventory at a price it has chosen rather than exposure in both directions.",
    range: "[ P · (1 − 2w) ,  P · (1 − w) ]",
    lifecycle: [
      "Price falls through the band → the position is all stock, and the inventory is held at cost.",
      "Price runs above the band → the position is idle quote asset; it is closed and re-placed.",
    ],
  },
] as const;

export const LP_EXPOSURE =
  "A concentrated position is short volatility and long fees. Both legs are priced at entry — the fee rate against the bleed rate at that pool's own volatility — and a position that fails that test is not opened at any size, whatever its headline yield.";

export const SIGNALS = [
  {
    title: "Opportunity board",
    body: "Pools ranked by what a $10,000 band would earn right now: share of in-range flow computed from on-chain active liquidity within ±5% of price, applied to the trailing 5-minute, 1-hour, 6-hour and 24-hour volume at the pool's own fee tier. A pool qualifies only when all six selection gates pass.",
    detail:
      "A pool that stops qualifying fades rather than vanishing and stays on the board for 24 hours, so a spike that has passed is still readable.",
    read: "The board ranks; it does not open positions. Every entry still has to pass the net test.",
    formula: "share  =  10,000 / ( 10,000 + L₅% )",
  },
  {
    title: "Smart-LP tracker",
    body: "Every liquidity add and remove on the tracked pools is attributed to the wallet behind it and valued at the pool price of that moment; every swap credits in-range positions with their share of the fee. A wallet's seven-day score is what it withdrew minus what it deposited, plus open positions at current price, plus fees credited.",
    detail:
      "Only positions opened and closed inside the window count as wins or losses, so a wallet that merely sits in a pool is followed but not judged. Contracts are tagged as bots and the protocol's own wallet as desk, so the tracker never scores itself.",
    read: "A pool the consistent winners are sitting in is worth a look; a pool they have just left is a warning.",
  },
] as const;

export const PAYOUT_STEPS = [
  {
    label: "Realized",
    body: "Fees collected less divergence loss taken, reported by the keeper. Lifetime realized profit Π(t) accumulates monotonically.",
  },
  {
    label: "Retained",
    body: "85% of each increase is retained as working capital. It funds new positions, absorbs losses, and is never paid out — holders have no claim on it.",
  },
  {
    label: "Owed",
    body: "The balance owed to holders is 15% of lifetime realized profit less what has already been paid. It carries forward and never resets.",
  },
  {
    label: "Paid",
    body: "Every 15 minutes the vault pays min(O, cash) in USDG, pro-rata over an eligibility-filtered holder snapshot, once at least $300 is owed.",
  },
] as const;

export const SNAPSHOT_NOTE =
  "The snapshot is reconstructed from the token's complete Transfer history maintained locally, never an indexer, and spot-verified against chain state before any value moves. AMM reserves, protocol machinery and desk addresses are excluded from the eligible supply; sub-dust allocations remain in the pot.";

export const INVARIANTS = [
  {
    invariant: "All balances live at one address",
    mechanism:
      "Positions, cash and fee inflow settle at the vault; the keeper's wallet carries only gas",
  },
  {
    invariant: "The keeper trades only sanctioned venues",
    mechanism: "exec() reverts on any target outside the allowlist",
  },
  {
    invariant: "Approvals cannot leak",
    mechanism: "Token approvals are spender-gated to the same allowlist",
  },
  {
    invariant: "Reported profit only increases",
    mechanism:
      "recordRealized() reverts on a total below the current one, so a report cannot be retracted to strand holders",
  },
  {
    invariant: "Only 15% is ever payable",
    mechanism:
      "holderAccrued tracks 15% of realized; distributions cannot exceed it less what has been paid",
  },
  {
    invariant: "Absorbing a loss cannot claw back",
    mechanism:
      "absorbLoss() reduces working capital and halts further accrual; it never reduces holderAccrued",
  },
  {
    invariant: "Distribution is rate-limited",
    mechanism: "Per-asset rolling 24h cap, contract-enforced",
  },
  {
    invariant: "The keeper is replaceable in one transaction",
    mechanism: "Rotation is a single transaction; custody is unaffected",
  },
  {
    invariant: "The owner can withdraw everything",
    mechanism:
      "The vault owner (the deployer wallet) may withdraw any asset at any time with no timelock and no governance process; the keeper cannot. This is the protocol's principal risk and it is not mitigated by the contract",
    flagged: true,
  },
] as const;

export const PARAMETERS = [
  { sym: "k", meaning: "Sigma multiple setting band width", value: "1.25σ" },
  { sym: "h", meaning: "Width horizon", value: "240 minute-intervals" },
  { sym: "w", meaning: "Half-width clamp", value: "1% – 60%" },
  { sym: "η", meaning: "Fee capture efficiency", value: "1 (upper bound)" },
  { sym: "V₁ₕ", meaning: "Minimum trailing-hour volume", value: "$25,000" },
  { sym: "L₅%", meaning: "Maximum liquidity within ±5%", value: "$400,000" },
  { sym: "B", meaning: "Reference band size for ranking", value: "$10,000" },
  { sym: "π", meaning: "Minimum fraction of 24h peak", value: "60%" },
  { sym: "a", meaning: "Minimum pool age", value: "20 minutes" },
  {
    sym: "r",
    meaning: "Intervals out of range before re-centring",
    value: "5",
  },
  {
    sym: "s",
    meaning: "Intervals of negative net before abandoning",
    value: "120",
  },
  {
    sym: "λ",
    meaning: "Net loss stop, against capital committed",
    value: "35%",
  },
  { sym: "—", meaning: "Holder share of realized profit", value: "15%" },
  { sym: "—", meaning: "Distribution threshold", value: "$300 owed" },
] as const;

export const CADENCES = [
  { label: "Pool re-evaluation", value: "continuous" },
  { label: "Distribution cycle", value: "every 15 minutes" },
  { label: "Board retention", value: "24 hours after a pool stops qualifying" },
  { label: "Smart-LP scoring window", value: "7 days" },
] as const;

export const PARAMETERS_NOTE =
  "Parameters are operating policy, not physical constants. They are published so the protocol's behaviour is predictable to the market it provides liquidity to — and so that a change to them is visible as a change.";

export const FAQS = [
  {
    question: "Who controls the vault?",
    answer:
      "The vault owner — the deployer wallet — can withdraw any asset at any time, with no timelock and no governance process. The keeper cannot: it is restricted to allowlisted venues and to distributions. This is the protocol's principal risk, it is not mitigated by the contract, and it means Resident is not non-custodial and should not be described as such.",
  },
  {
    question: "Has the protocol been audited?",
    answer:
      "No. The contracts are covered by a test suite but have not been reviewed by a third party, and nothing has been deployed to mainnet. Any audit will be published here with its findings, resolved or otherwise.",
  },
  {
    question: "Why open a narrow band rather than a wide safe one?",
    answer:
      "Because share is density-weighted: the same capital over ±20% has a quarter the liquidity density of ±5%, and earns proportionally less of the flow crossing any price. Width is not free safety, it is paid for in income — so it is set from the pool's measured volatility rather than chosen for comfort.",
  },
  {
    question: "What happens when a position loses money?",
    answer:
      "The loss is absorbed by retained working capital. Profit already accrued to holders is never reversed, but accrual pauses until the loss is recovered, and a smaller capital base earns proportionally less afterwards. Positions are re-centred rather than closed into thin books, which means capital can sit in a losing name for a long time.",
  },
  {
    question: "How is realized profit determined?",
    answer:
      "It is reported by the keeper; profit on an arbitrary venue cannot be derived on-chain without trusting the same quote the keeper used, so the contract does not verify it. It does enforce that reported totals only increase, that only 15% is ever payable, and that distributions never exceed what is owed or what the vault holds.",
  },
  {
    question: "Are the fee figures on this site achieved returns?",
    answer:
      "No. They are estimates at capture efficiency 1, which credits a position with every fee paid at every price it covers — an upper bound. Measured against a route-level simulation the realised figure was far below it. Read every projected fee number here as a ceiling, and note that nothing has been deployed, so there are no achieved returns to report.",
  },
] as const;

export const DOCS_BLURB =
  "Every threshold on this page is the value the code runs with, quoted from it rather than paraphrased.";

export const TAGLINE = "The resident market maker for tokenized equities";
