/**
 * Docs copy, written for someone who has never provided liquidity before.
 *
 * Two rules held throughout: no term is used before it is explained in ordinary
 * words, and no number is softened. Plain language is about the words, not the
 * facts — the custody risk, the missing keeper and the "these are ceilings, not
 * results" caveat are all still here, just said in a way a normal person can
 * act on.
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
  { label: "The idea", href: "#overview" },
  { label: "The money", href: "#capital" },
  { label: "Picking pools", href: "#selection" },
  { label: "The range", href: "#width" },
  { label: "Opening", href: "#entry" },
  { label: "Managing", href: "#management" },
  { label: "Getting paid", href: "#accounting" },
  { label: "Control", href: "#custody" },
  { label: "Settings", href: "#parameters" },
] as const;

export const HERO_HEADLINE = "How Resident works, in plain English.";

export const HERO_STANDFIRST =
  "Resident puts money into trading pools for tokenized stocks and collects a cut of the trades that happen there. The fees from $RES pay for it. 15% of what it makes goes to holders every 15 minutes, and 85% goes back in to buy more positions.";

export const HERO_NOTE =
  "No jargon without an explanation, and no number talked up. The parts that are unfinished or risky are on this page too.";

export const PILLARS = [
  {
    icon: "reference" as const,
    eyebrow: "The range fits the pool",
    body: "Calm pools get a tight range, jumpy pools get a wide one. It is worked out from how much each pool actually moves, not picked once and reused.",
  },
  {
    icon: "probe" as const,
    eyebrow: "Big fees are not enough",
    body: "A pool can pay great fees and still lose you money if the price swings hard. Resident only opens when the fees should beat the swings.",
  },
  {
    icon: "payout" as const,
    eyebrow: "15% to holders",
    body: "Paid every 15 minutes, straight to your wallet, in USDG. Nothing to stake, nothing to claim.",
  },
] as const;

/** The money's route, start to finish. */
export const CYCLE = [
  { step: "Someone trades $RES", note: "A fee is charged on the trade" },
  { step: "The fee lands in the vault", note: "One wallet holds everything" },
  { step: "A pool is picked", note: "It has to clear six checks" },
  { step: "A range is set", note: "Tight for calm pools, wide for jumpy ones" },
  {
    step: "The maths is checked",
    note: "Open only if fees should beat the swings",
  },
  {
    step: "The position is minded",
    note: "Moved when the price walks away from it",
  },
  {
    step: "Profit is counted",
    note: "Fees collected, minus what the swings cost",
  },
] as const;

export const METHOD = [
  {
    n: "01",
    id: "overview",
    title: "The idea",
    body: [
      "When you swap one token for another, you are trading against a pool of money someone else put there. They put it up, and they get a small cut of every trade that uses it. That is what Resident does: it is the money in the pool, collecting the cut.",
      'The twist is that you do not have to cover every price. You can say "my money is only in play between $9 and $11". Inside that window you earn a much bigger share of the trades, because your money is concentrated where the action is. Outside it you earn nothing, and you just sit holding whatever the pool left you with.',
      "So the whole game is picking the right pools, setting a window that the price will actually stay inside, and knowing when to give up on one. That is all Resident does.",
    ],
    pull: "You are not betting on the price going up. You are being paid rent for letting other people trade.",
  },
  {
    n: "02",
    id: "capital",
    title: "Where the money comes from",
    body: [
      "Every time someone buys or sells $RES, a fee is charged. That fee goes into the vault, and the vault is what buys the positions. There is no raise, no VC round, no treasury sitting on the side.",
      "Which cuts both ways, and it is worth being honest about it: if nobody trades $RES, there are no fees, so there is nothing to put into positions, so there is nothing to pay out. The token's activity and the payouts are tied together on purpose, and nothing separates them.",
    ],
  },
  {
    n: "03",
    id: "selection",
    title: "How pools get picked",
    body: [
      "A pool has to pass all six of these. Fail one and it is out, no matter how good it looks otherwise.",
      "It has no custom code attached that could take the fees before they reach us. At least $25,000 has been traded in it in the last hour, because a quiet pool pays nothing. There is not too much money already in it — no more than $400,000 near the current price — because the more crowded it is, the smaller our slice. The price is still within 40% of its 24-hour high, so we are not the ones catching a falling knife. It is at least 20 minutes old, which skips the chaos of a brand-new launch. And other people providing money to that pool are currently making money, not losing it.",
      "Pools that stop qualifying stay on the board for another 24 hours instead of vanishing, so you can still see what happened after a busy spell has passed.",
    ],
  },
  {
    n: "04",
    id: "width",
    title: "How wide the range is",
    body: [
      "A narrow range earns more per trade but the price escapes it sooner. A wide range earns less but holds on longer. There is no setting that is good at both, so the width is worked out per pool from how much that pool actually bounces around.",
      "Roughly: halve the width and you about double the earnings, but you spend more time out of the range earning nothing. Resident sits at a width that keeps the price inside about 91% of the time. Going wider — enough to be in range 99.8% of the time — would give up about half the income to buy those last few percent. That trade is not worth it, so it does not take it.",
      "In practice the range is never tighter than 1% or wider than 60% either side of the price.",
    ],
  },
  {
    n: "05",
    id: "entry",
    title: "When it actually opens one",
    body: [
      "Here is the part most dashboards get wrong. When the price moves while your money is in a range, you end up holding more of whatever went down and less of whatever went up. You are worse off than if you had just held the two tokens and done nothing. That cost is real and it grows with how much the price moves.",
      "So a pool paying 3% a day sounds great until you notice the price swings 20% a day, at which point you are losing money while collecting fees. A list ranked by fees recommends that pool every single time.",
      "Resident compares the two before opening anything: expected fees against expected cost of the swings, at that specific pool's own jumpiness. If the fees do not win, it does not open, no matter how big the fee number is.",
    ],
  },
  {
    n: "06",
    id: "management",
    title: "Looking after an open position",
    body: [
      "If the price drifts out of the range, the position stops earning. It is not moved straight away — prices poke past the edge and come back all the time — but if it stays out, the position is picked up and re-centred on the new price.",
      "A position is closed if what it has actually made, after the cost of the swings, falls 35% below what was put in. If a pool keeps being unprofitable for long enough, it is dropped entirely rather than re-centred, because the problem is the pool, not the position.",
      "One thing to be clear about: a position that has gone against us is held and moved, not dumped. That means money can sit in a bad name for a while. It is a deliberate choice — selling into a thin pool usually makes the loss worse — but it is a real cost, not a clever trick.",
    ],
  },
  {
    n: "07",
    id: "accounting",
    title: "Getting paid",
    body: [
      "Everything the desk makes gets split two ways. 15% is owed to $RES holders. 85% goes back in to open more positions.",
      "The 15% is sent to your wallet every 15 minutes, in USDG, split by how much $RES you hold. You do not stake anything, you do not claim anything, and you do not sign anything. If the total owed is under $300 it waits until the next round rather than spending more on fees than it pays out.",
      "What you are owed only ever goes up until it is paid. If the desk loses money, that comes out of the 85% — your share of past profits is never taken back. But no new profit is added to your side until the desk has earned the loss back, so payouts go quiet for a while.",
      "Worth knowing: the 85% is not your money being held back. It is the desk's working capital. It takes the losses, and you have no claim on it.",
    ],
  },
  {
    n: "08",
    id: "limits",
    title: "What is not finished, and what we do not know",
    body: [
      "None of this is running yet. The contract that holds the money is written and tested, but it has not been checked by an outside security firm and it has never been deployed. There is no vault holding anything today. The positions page is showing example numbers to demonstrate the format, and says so at the top.",
      "The part that would actually open and manage positions has not been built yet. What exists is the vault, the maths, and the site. Anyone telling you this is live is wrong.",
      "And every fee figure on this site is a best case, not a result. The calculation assumes every single trade in a pool goes through our range and pays us — which never quite happens. When we checked that assumption against a proper simulation, the real number came out far lower. Read every projected figure here as a ceiling.",
    ],
  },
] as const;

export const LP_BANDS = [
  {
    mode: "the usual one",
    label: "A window around today's price",
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
    mode: "the patient one",
    label: "A window sitting below the price",
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
  "In one line: you are being paid fees in exchange for taking on the cost of the price moving. Both halves are worked out before anything is opened, and if the fees do not beat the cost, nothing is opened at any size.";

export const SIGNALS = [
  {
    title: "The pool board",
    body: "A ranked list of where $10,000 would earn the most right now. It works out what slice of the trading we would get based on how much money is already sitting near the price, then applies that to what has actually traded over the last 5 minutes, hour, 6 hours and day.",
    detail:
      "Pools that stop qualifying fade off the board over 24 hours rather than disappearing, so a spike that has already passed is still visible.",
    read: "The board is a shortlist, not a decision. Everything on it still has to pass the fees-beat-the-swings test.",
  },
  {
    title: "Watching who wins",
    body: "Every time someone adds or removes money from a tracked pool, it is recorded and valued at the price of that moment, and every trade credits the people whose money was in range. Over a week that gives a score: what they took out, minus what they put in, plus what they still hold and what they earned.",
    detail:
      "Only positions that were both opened and closed inside the week count as wins or losses, so someone who just parks money is followed but not judged. Bots are tagged, and our own wallet is tagged, so the tracker never scores itself.",
    read: "A pool the consistent winners are sitting in is worth a look. One they have just left is a warning.",
  },
] as const;

export const PAYOUT_STEPS = [
  {
    label: "What it made",
    body: "Fees collected, minus what the price moves cost. This number only ever goes up.",
  },
  {
    label: "85% stays in",
    body: "Working capital. It buys the next positions and it absorbs the losses. Holders have no claim on it.",
  },
  {
    label: "15% is yours",
    body: "Owed to holders and carried forward until it is paid. It never resets.",
  },
  {
    label: "Paid out",
    body: "Every 15 minutes, in USDG, split by how much you hold — once at least $300 is owed in total.",
  },
] as const;

export const SNAPSHOT_NOTE =
  "Who holds what is worked out from the token's own full transfer history, kept locally rather than trusted to a third party, and checked against the chain before any money moves. Pools, contracts and the desk's own wallets are left out of the split.";

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
      "The wallet that deploys the vault can withdraw any asset at any time, with no delay and no vote. The bot cannot. This is the biggest risk here, the contract does not prevent it, and it means this is not trustless — someone has to be trusted",
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
  { label: "Pools re-checked", value: "constantly" },
  { label: "Payouts", value: "every 15 minutes" },
  { label: "Board memory", value: "24 hours" },
  { label: "Who-wins scoring", value: "over 7 days" },
] as const;

export const PARAMETERS_NOTE =
  "These are settings, not laws of nature. They are published so you can see what the desk is doing — and so that changing one is visible as a change.";

export const FAQS = [
  {
    question: "Who can take the money?",
    answer:
      "The wallet that deploys the vault can withdraw everything at any time. There is no delay, no vote, and no way to stop it. The bot cannot — it can only trade at approved places and pay holders. This is the biggest risk here and no amount of code removes it, so it is stated plainly rather than left for you to find out.",
  },
  {
    question: "Has anyone checked the code?",
    answer:
      "Not from outside. It has a test suite that we wrote, which is not the same thing as a security audit, and nothing has been deployed. When there is an audit it will be published here along with whatever it found, fixed or not.",
  },
  {
    question: "Is it running right now?",
    answer:
      "No. The vault contract is written and tested, but the part that opens and manages positions has not been built, and nothing is deployed. The positions page shows example numbers to demonstrate the layout, and says so at the top.",
  },
  {
    question: "Why not just pick the pool with the biggest fees?",
    answer:
      "Because a pool can pay huge fees and still lose you money if the price swings hard enough. When the price moves you end up holding more of whatever fell — that cost is real, and it can be bigger than the fees. Resident checks both before opening anything.",
  },
  {
    question: "Why a narrow range instead of a safe wide one?",
    answer:
      "Width is not free. A wide range earns much less per trade, because your money is spread thin over prices where nothing is happening. Narrow earns more but gets left behind sooner. The width is set from how much each pool actually moves rather than picked for comfort.",
  },
  {
    question: "What happens if it loses money?",
    answer:
      "The loss comes out of the 85% working capital first. What you are already owed is never taken back — but nothing new is added to your side until the desk has made the loss back, so payouts go quiet. Positions that go against us are held and moved rather than dumped, so money can sit in a bad name for a while.",
  },
  {
    question: "Do I have to stake or claim anything?",
    answer:
      "No. Hold $RES in your wallet and payouts arrive. There is nothing to lock up, nothing to sign, and nothing that expires.",
  },
  {
    question: "Are the numbers on this site real returns?",
    answer:
      "No, and this matters. They assume every trade in a pool goes through our range and pays us in full, which never quite happens. Checked against a proper simulation, the real figure came out far lower. Treat every projection here as a best case, and remember nothing has been deployed, so there are no actual returns to show.",
  },
] as const;

export const DOCS_BLURB =
  "Everything on this page is set in the code, and the numbers here are the ones it actually uses.";

export const TAGLINE = "The resident market maker for tokenized equities";
