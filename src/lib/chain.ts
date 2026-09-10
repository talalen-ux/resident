/**
 * Robinhood Chain constants.
 *
 * PROVENANCE AND VERIFICATION STATUS — read before deploying anything.
 *
 * The addresses below were transcribed from official sources and each was
 * fetched twice from two different URLs, character-for-character identical both
 * times. That establishes the transcription is faithful. It does NOT establish
 * that the address holds the contract it is labelled with, because this
 * environment's egress policy blocks the Robinhood Chain RPC and its block
 * explorer, so nothing here has been checked against the chain itself.
 *
 * Run `npm run verify:chain` from a machine with RPC access before any of this
 * touches money. It checks the chain id, confirms every address has bytecode,
 * and reads USDG's symbol and decimals back.
 *
 * Sources:
 *   Uniswap v3/v4   github.com/Uniswap/contracts/blob/main/deployments/4663.md
 *   Pons            github.com/ponsdotdev/ponsfamily README
 *   USDG / WETH     docs.robinhood.com/chain/contracts, supplied directly by
 *                   the operator from the page itself
 *   Chain id / RPC  web search of docs.robinhood.com/chain (the docs site
 *                   itself is egress-blocked, so this one is second-hand and
 *                   the weakest link in the list — confirm it first)
 */

import { ALL_TOKENS, ETF_TOKENS, STOCK_TOKENS } from "./tokens.ts";

export const MAINNET = {
  name: "Robinhood Chain",
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  gasToken: "ETH",
} as const;

export const TESTNET = {
  name: "Robinhood Chain Testnet",
  chainId: 46630,
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  gasToken: "ETH",
} as const;

/**
 * Canonical tokens, from docs.robinhood.com/chain/contracts.
 *
 * The docs are explicit that this registry is an identity check, not a
 * convenience: "a token with a matching name/ticker but a different contract
 * address is not a Robinhood Stock Token." That matters more here than in most
 * systems — see {@link isCanonical}.
 */
export const TOKENS = {
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
} as const;

/**
 * The canonical registry lives in ./tokens.ts, generated from the chain's
 * contracts page. The desk MUST NOT hold a token that is not in it: a
 * fillability probe proves a pool can be sold into, not that the thing being
 * bought is the real equity.
 */
export { ALL_TOKENS, ETF_TOKENS, STOCK_TOKENS };
export type { TokenEntry } from "./tokens.ts";

/**
 * Lowercased addresses the desk may take inventory in.
 *
 * Stock tokens plus the quote assets — deliberately NOT the tokenized ETFs,
 * which are canonical but excluded from the program categorically.
 */
export function tradableAddresses(): Set<string> {
  return new Set(
    [
      TOKENS.usdg,
      TOKENS.weth,
      ...Object.values(STOCK_TOKENS).map((t) => t.address),
    ].map((a) => a.toLowerCase()),
  );
}

/** Lowercased addresses of the tokenized ETFs, which are canonical but barred. */
export function etfAddresses(): Set<string> {
  return new Set(
    Object.values(ETF_TOKENS).map((t) => t.address.toLowerCase()),
  );
}

/** Lowercased addresses that are canonical at all, ETFs included. */
export function canonicalAddresses(): Set<string> {
  return new Set(
    [
      TOKENS.usdg,
      TOKENS.weth,
      ...Object.values(ALL_TOKENS).map((t) => t.address),
    ].map((a) => a.toLowerCase()),
  );
}

/** Whether an address is a canonical Robinhood token at all. */
export const isCanonical = (address: string) =>
  canonicalAddresses().has(address.toLowerCase());

/** Whether the desk is permitted to take inventory in this token. */
export const isTradable = (address: string) =>
  tradableAddresses().has(address.toLowerCase());

/** Ticker for a canonical address, or null. */
export function tickerFor(address: string): string | null {
  const lower = address.toLowerCase();
  for (const [ticker, entry] of Object.entries(ALL_TOKENS)) {
    if (entry.address.toLowerCase() === lower) return ticker;
  }
  return null;
}

/** Uniswap deployments on chain 4663, from the official Uniswap contracts repo. */
export const UNISWAP = {
  v3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  v3Quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7", // QuoterV2
  v3Router: "0xcaf681a66d020601342297493863e78c959e5cb2", // SwapRouter02
  v3PositionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  v3TickLens: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468",
  multicall: "0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3",
  v4PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  v4PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  v4StateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
} as const;

/**
 * Pons launchpad.
 *
 * There is no static fee-escrow address to configure: the V2 system keeps a
 * claim-based `IPonsV2FeeEscrow` ledger rather than one escrow contract, and
 * every launch mints into its own bonding curve. The vault is set as the
 * launch's creator-fee recipient and the keeper claims against the ledger, so
 * what the desk needs is the factory plus the $RES launch address.
 */
export const PONS = {
  v2Factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  v1Factory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
} as const;

/** Widened from the `as const` defaults, so an env override can replace one. */
export type UniswapAddresses = { -readonly [K in keyof typeof UNISWAP]: string };
export type PonsAddresses = { -readonly [K in keyof typeof PONS]: string };

export type ChainConfig = {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  usdg: string;
  vault: string;
  resToken: string | null;
  uniswap: UniswapAddresses;
  pons: PonsAddresses;
};

/**
 * Values with no published source found, which therefore have no default and
 * must be supplied. Guessing either would be inventing an address that will
 * hold money.
 */
const REQUIRED: Array<[string, string]> = [
  ["RESIDENT_VAULT", "your deployed ResidentVault"],
];

export function missingKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED.filter(([key]) => !env[key]).map(([key]) => key);
}

export const isConfigured = (env: NodeJS.ProcessEnv = process.env) =>
  missingKeys(env).length === 0;

/**
 * Resolve the chain without demanding a vault.
 *
 * The vault is the one address here that we deploy ourselves, so there is a
 * window — everything before the deploy — where the rest of the manifest is
 * worth checking and the vault cannot be. Verifying the addresses is the FIRST
 * step of going live and deploying the vault is the third; requiring a vault to
 * resolve the chain made the first step impossible to run in that order.
 *
 * `vault` is the empty string when unset. Callers that spend money must use
 * requireChain instead, which refuses to resolve at all without one.
 */
export function chainBeforeVault(
  env: NodeJS.ProcessEnv = process.env,
): ChainConfig {
  const testnet = env.RESIDENT_NETWORK === "testnet";
  const net = testnet ? TESTNET : MAINNET;

  return {
    name: env.RESIDENT_CHAIN_NAME ?? net.name,
    chainId: Number(env.RESIDENT_CHAIN_ID ?? net.chainId),
    rpcUrl: env.RESIDENT_RPC_URL ?? net.rpcUrl,
    explorer: env.RESIDENT_EXPLORER ?? net.explorer,
    usdg: env.RESIDENT_USDG ?? TOKENS.usdg,
    vault: env.RESIDENT_VAULT ?? "",
    resToken: env.RESIDENT_TOKEN ?? null,
    uniswap: {
      ...UNISWAP,
      ...(env.RESIDENT_V3_FACTORY
        ? { v3Factory: env.RESIDENT_V3_FACTORY }
        : {}),
      ...(env.RESIDENT_V3_QUOTER ? { v3Quoter: env.RESIDENT_V3_QUOTER } : {}),
      ...(env.RESIDENT_V3_ROUTER ? { v3Router: env.RESIDENT_V3_ROUTER } : {}),
      ...(env.RESIDENT_V3_POSITION_MANAGER
        ? { v3PositionManager: env.RESIDENT_V3_POSITION_MANAGER }
        : {}),
    },
    pons: {
      ...PONS,
      ...(env.RESIDENT_PONS_V2_FACTORY
        ? { v2Factory: env.RESIDENT_PONS_V2_FACTORY }
        : {}),
    },
  };
}

/** Resolve the chain config, or throw naming what is missing and why. */
export function requireChain(
  env: NodeJS.ProcessEnv = process.env,
): ChainConfig {
  const missing = REQUIRED.filter(([key]) => !env[key]);
  if (missing.length) {
    throw new Error(
      "Robinhood Chain is not fully configured:\n" +
        missing.map(([key, why]) => `  ${key} — ${why}`).join("\n") +
        "\nSee INTEGRATIONS.md.",
    );
  }
  return chainBeforeVault(env);
}

/**
 * Every address the desk will interact with, for the verifier to walk.
 *
 * The vault is included only once it exists. Before the deploy there is nothing
 * at that address, and reporting "no code" for it would be noise sitting next
 * to the failures that matter.
 */
export function addressManifest(config: ChainConfig): Array<[string, string]> {
  return [
    ["USDG", config.usdg],
    ["WETH", TOKENS.weth],
    ["UniswapV3Factory", config.uniswap.v3Factory],
    ["QuoterV2", config.uniswap.v3Quoter],
    ["SwapRouter02", config.uniswap.v3Router],
    ["NonfungiblePositionManager", config.uniswap.v3PositionManager],
    ["TickLens", config.uniswap.v3TickLens],
    ["v4 PoolManager", config.uniswap.v4PoolManager],
    ["v4 Quoter", config.uniswap.v4Quoter],
    ["v4 StateView", config.uniswap.v4StateView],
    ["UniversalRouter", config.uniswap.universalRouter],
    ["Permit2", config.uniswap.permit2],
    ["PonsV2LaunchFactory", config.pons.v2Factory],
    ...(config.vault ? [["ResidentVault", config.vault] as [string, string]] : []),
  ];
}
