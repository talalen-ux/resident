/** The shape the dashboard renders. One adapter fills it; the views never care which. */

export type LedgerState = {
  /** Lifetime realized profit, in payout-asset minor units. */
  realized: bigint;
  /** Retained 85%, less losses. Funds new LP positions; never distributed. */
  workingCapital: bigint;
  /** Lifetime paid to holders. */
  distributed: bigint;
  /** holderAccrued (15% of realized) − distributed. Carries forward. */
  owed: bigint;
  /** Payout-asset balance actually sitting in the vault. */
  cash: bigint;
  /** Remaining allowance in the rolling 24h window. */
  rateLimitRemaining: bigint;
};

export type VaultState = {
  address: string;
  owner: string;
  keeper: string;
  /** Venues the keeper may call and approve. */
  venues: string[];
  payoutAsset: { address: string; symbol: string; decimals: number };
};

export type Position = {
  symbol: string;
  instrument: string;
  /** Units held, in token minor units. */
  quantity: bigint;
  decimals: number;
  /** Average cost basis per unit, in payout-asset minor units. */
  basis: bigint;
  /** Reference price per unit, in payout-asset minor units. */
  reference: bigint;
  /** Best venue marginal price per unit. */
  mark: bigint;
};

/**
 * An open concentrated-liquidity position.
 *
 * Distinct from {@link Position}, which is spot inventory. A band is capital
 * committed between two prices: it earns fees only while price trades inside
 * the range, so `inRange` is the difference between a position that is working
 * and one that is merely open.
 */
export type BandPosition = {
  pool: string;
  symbol: string;
  instrument: string;
  /** Quote asset the band is paired against, e.g. "USDG". */
  quote: string;
  /** Pool fee tier in hundredths of a bip: 3000 = 0.30%. */
  feeTier: number;
  /** Range bounds and current price, in payout-asset minor units per unit. */
  lower: bigint;
  upper: bigint;
  price: bigint;
  /** Capital currently committed, in payout-asset minor units. */
  capital: bigint;
  /** Fees earned by this position since it was opened. */
  feesEarned: bigint;
  /** True while price sits inside [lower, upper] and the band is earning. */
  inRange: boolean;
  openedAt: string;
};

export type Dislocation = {
  pool: string;
  symbol: string;
  /** Deviation from reference, as a fraction: 0.42 = +42%. */
  deviation: number;
  /** Probe yield in payout-asset minor units; null when the probe returned nothing. */
  probeYield: bigint | null;
  /** Sellable depth above the profit floor. */
  depth: bigint;
  qualifies: boolean;
  /** Why it does not qualify, when it does not. */
  blockedBy: string | null;
};

export type Distribution = {
  at: string;
  total: bigint;
  recipients: number;
  txHash: string;
};

export type EligibleInstrument = {
  symbol: string;
  /** Impact at $1k and $10k notional, as fractions. */
  impact1k: number;
  impact10k: number;
  classification: "eligible" | "deep" | "excluded";
  reason: string;
};

export type DeskSnapshot = {
  /** When the adapter read this. */
  readAt: string;
  /** True when the figures come from fixtures rather than a chain. */
  isFixture: boolean;
  /** Chain the adapter is pointed at, or null when running on fixtures. */
  chain: string | null;
  vault: VaultState;
  ledger: LedgerState;
  positions: Position[];
  /** Open concentrated-liquidity bands. */
  bands: BandPosition[];
  dislocations: Dislocation[];
  distributions: Distribution[];
  eligible: EligibleInstrument[];
};

export interface DeskAdapter {
  readonly isFixture: boolean;
  snapshot(): Promise<DeskSnapshot>;
}
