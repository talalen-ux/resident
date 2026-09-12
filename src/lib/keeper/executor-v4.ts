/**
 * Turning intents into transactions on Robinhood Chain.
 *
 * Everything goes through the vault. The keeper never holds an asset and never
 * calls a venue directly: it calls `vault.exec(venue, value, data)`, and the
 * vault rejects any venue that is not allowlisted. That is the whole point of
 * the separation, so this module's output is always a call to the vault and
 * never a call to Uniswap.
 *
 * THE ONE RULE AN EXECUTOR MUST HONOUR
 *
 * If a call is broadcast and its outcome cannot be established, this throws
 * {@link Unconfirmed} rather than an ordinary error. An ordinary error is
 * recorded as a failure and stepped past; Unconfirmed leaves the intent in
 * flight so the next tick has to go and look at the chain. Getting that
 * backwards is how the same position gets opened twice, which is the failure
 * the whole registry exists to prevent.
 */

import { Interface } from "ethers";

import { UNISWAP } from "../chain.ts";
import { claimCall, escrowOf, sweepCall, verifyClaim } from "./pons.ts";
import { POSITION_SELECTORS } from "./position-reader.ts";
import type { PoolKey } from "../sim/v4.ts";
import type { PoolState } from "../sim/v3.ts";
import {
  alignTick,
  amount0Delta,
  amount1Delta,
  liquidityForAmounts,
  spotPrice,
  sqrtPriceAtTick,
  tickAtPrice,
} from "../sim/v3.ts";
import { planClose, planCollect, planMint, planRecentre } from "./v4-actions.ts";
import { Unconfirmed } from "./registry.ts";
import type { Signer, UnsignedCall } from "./signer.ts";
import type { Intent } from "./types.ts";

const VAULT = new Interface([
  "function exec(address venue, uint256 value, bytes data) returns (bytes)",
  "function approveVenue(address token, address venue, uint256 amount)",
  "function recordRealized(uint256 newTotal)",
  "function absorbLoss(uint256 amount, string reason)",
  "function distribute(address[] recipients, uint256[] amounts)",
]);

const PERMIT2 = new Interface([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

/** What the executor needs to know about the chain it is acting on. */
export type V4Context = {
  vault: string;
  positionManager?: string;
  permit2?: string;
  /** The pool behind a board entry, or null when it is not one we can open. */
  poolFor(name: string): { key: PoolKey; state: PoolState } | null;
  /**
   * The pool key and token id behind a position the registry holds.
   *
   * The registry stores a venue handle it never interprets, so turning one back
   * into something callable is the executor's job and not the loop's.
   */
  positionFor(
    positionId: string,
  ): { key: PoolKey; tokenId: bigint; capital: number; halfWidth: number } | null;
  /** Read a pool fresh, at submission time. */
  readPool(key: PoolKey): Promise<PoolState>;
  /** Free balance of a token held by the vault, in minor units. */
  balanceOf(token: string): Promise<bigint>;
  /**
   * Wait for a receipt. Null means the outcome is not yet known, which this
   * module turns into Unconfirmed rather than into a failure.
   */
  receipt(hash: string): Promise<{ ok: boolean; logs: RawLog[] } | null>;
  signer: Signer;
  /** Seconds, for deadlines. */
  now(): number;
  /** How long a submitted call has to land before its outcome is unknown. */
  deadlineSeconds?: number;
  /** Slippage allowed on a mint, as a fraction. */
  slippage?: number;
  /**
   * The Pons meme hook holding the launch's fees.
   *
   * Optional: a desk with no launch of its own still runs, it simply never
   * claims. The escrow is read off this hook rather than configured.
   */
  ponsHook?: string;
  /** Raw eth_call, for the reads a claim has to make. */
  call(to: string, data: string): Promise<string>;
};

export type RawLog = { address: string; topics: string[]; data: string };

/** ERC721 Transfer, which is how a v4 mint announces its token id. */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * The token id a mint produced, from the position manager's own Transfer log.
 *
 * Read rather than assumed. `nextTokenId` before the call would be a guess that
 * is wrong the moment anyone else mints in the same block, and a wrong id here
 * means the registry tracks a position the desk does not own.
 */
export function tokenIdFromLogs(
  logs: RawLog[],
  positionManager: string,
  owner: string,
): bigint | null {
  const pm = positionManager.toLowerCase();
  const to = owner.toLowerCase().slice(2).padStart(64, "0");
  for (const log of logs) {
    if (log.address.toLowerCase() !== pm) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 4) continue;
    if (log.topics[2].slice(2).toLowerCase() !== to) continue;
    return BigInt(log.topics[3]);
  }
  return null;
}

/** The tick range a band with this half-width occupies at this price. */
export function bandTicks(
  state: PoolState,
  halfWidth: number,
): { tickLower: number; tickUpper: number } {
  const price = spotPrice(state);
  const d0 = state.token0.decimals;
  const d1 = state.token1.decimals;
  // Rounded outward: rounding a lower bound up and an upper bound down would
  // quietly place a narrower position than the model asked for.
  return {
    tickLower: alignTick(
      tickAtPrice(price * (1 - halfWidth), d0, d1),
      state.tickSpacing,
      "down",
    ),
    tickUpper: alignTick(
      tickAtPrice(price * (1 + halfWidth), d0, d1),
      state.tickSpacing,
      "up",
    ),
  };
}

/**
 * The tick range for an ask ladder: entirely above the price.
 *
 * A v3-style range placed wholly above spot holds only token0 and sells it as
 * the price rises through — which is the ladder. The one thing that must not go
 * wrong is the range straddling spot: a range that includes the current price
 * is a two-sided band that takes quote as well, and would silently buy the
 * token this position exists to sell. The lower bound is therefore rounded UP,
 * away from the price, and asserted to sit above the current tick.
 *
 * Where the stock is token1 rather than token0 the pool is ordered the other
 * way round and selling the stock means a range BELOW spot; that is the same
 * position seen from the other side, and the caller gets it by passing a
 * negative gap.
 */
export function ladderTicks(
  state: PoolState,
  gap: number,
  width: number,
): { tickLower: number; tickUpper: number } {
  const price = spotPrice(state);
  const d0 = state.token0.decimals;
  const d1 = state.token1.decimals;
  const spacing = state.tickSpacing;

  const lower = alignTick(tickAtPrice(price * (1 + gap), d0, d1), spacing, "up");
  const upper = alignTick(
    tickAtPrice(price * (1 + gap) * (1 + width), d0, d1),
    spacing,
    "up",
  );

  // One spacing clear of the current tick, so a price that ticks up between
  // decision and submission cannot leave the range straddling it.
  const floor = alignTick(state.tick, spacing, "up") + spacing;
  const tickLower = Math.max(lower, floor);
  const tickUpper = Math.max(upper, tickLower + spacing);

  return { tickLower, tickUpper };
}

/**
 * How much liquidity `capital` of the quote asset buys over a range.
 *
 * Sized off the quote side alone and then capped by what the vault actually
 * holds of each token. A mint that asks for more of a token than the vault has
 * does not fail cheaply: it reverts after the gas is spent.
 */
export function sizeMint(args: {
  state: PoolState;
  tickLower: number;
  tickUpper: number;
  /** Quote units to commit, in the quote token's minor units. */
  quoteAmount: bigint;
  balance0: bigint;
  balance1: bigint;
}): { liquidity: bigint; amount0: bigint; amount1: bigint } {
  const sqrtP = args.state.sqrtPriceX96;
  const sqrtA = sqrtPriceAtTick(args.tickLower);
  const sqrtB = sqrtPriceAtTick(args.tickUpper);

  // The quote is token1 unless the pool is ordered the other way round.
  const quoteIsToken1 = !args.state.stockIsToken1;
  const wanted0 = quoteIsToken1 ? args.balance0 : args.quoteAmount;
  const wanted1 = quoteIsToken1 ? args.quoteAmount : args.balance1;

  const target = liquidityForAmounts(sqrtP, sqrtA, sqrtB, wanted0, wanted1);
  const affordable = liquidityForAmounts(
    sqrtP,
    sqrtA,
    sqrtB,
    args.balance0,
    args.balance1,
  );
  const liquidity = target < affordable ? target : affordable;

  return {
    liquidity,
    amount0: amount0Delta(
      sqrtP < sqrtA ? sqrtA : sqrtP > sqrtB ? sqrtB : sqrtP,
      sqrtB,
      liquidity,
    ),
    amount1: amount1Delta(
      sqrtA,
      sqrtP < sqrtA ? sqrtA : sqrtP > sqrtB ? sqrtB : sqrtP,
      liquidity,
    ),
  };
}

const withSlippage = (amount: bigint, fraction: number) =>
  amount + (amount * BigInt(Math.round(fraction * 10_000))) / 10_000n;

/** Wrap a venue call so it goes through the vault rather than around it. */
/** ERC20 balance in raw units, for checking a claim actually landed. */
async function balanceOfRaw(
  call: (to: string, data: string) => Promise<string>,
  token: string,
  holder: string,
): Promise<bigint> {
  const data =
    POSITION_SELECTORS.balanceOf +
    holder.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const result = await call(token, data);
  return !result || result === "0x" ? 0n : BigInt(result);
}

export function viaVault(
  vault: string,
  venue: string,
  data: string,
  description: string,
  value = 0n,
): UnsignedCall {
  return {
    to: vault,
    data: VAULT.encodeFunctionData("exec", [venue, value, data]),
    description,
  };
}

/**
 * Approvals a mint needs before it can settle.
 *
 * The position manager pulls tokens through Permit2, not through a plain ERC20
 * allowance, so two grants are needed and both are made by the vault: the ERC20
 * approval to Permit2, and the Permit2 allowance to the position manager. Both
 * addresses therefore have to be allowlisted venues, which is a deployment step
 * and not something this can do for itself.
 */
export function approvalsFor(
  ctx: { vault: string; permit2?: string; positionManager?: string },
  token: string,
  amount: bigint,
  expiry: number,
): UnsignedCall[] {
  const permit2 = ctx.permit2 ?? UNISWAP.permit2;
  const pm = ctx.positionManager ?? UNISWAP.v4PositionManager;
  return [
    {
      to: ctx.vault,
      data: VAULT.encodeFunctionData("approveVenue", [token, permit2, amount]),
      description: `approve Permit2 to move ${token}`,
    },
    viaVault(
      ctx.vault,
      permit2,
      PERMIT2.encodeFunctionData("approve", [token, pm, amount, expiry]),
      `let the position manager pull ${token} through Permit2`,
    ),
  ];
}

export type ExecutorResult = {
  handle?: string;
  amount?: number;
  txHash?: string;
};

/**
 * An executor for Robinhood Chain.
 *
 * Returns a function of the shape {@link submit} expects, so the loop does not
 * know which chain it is on.
 */
export function makeV4Executor(ctx: V4Context) {
  const pm = ctx.positionManager ?? UNISWAP.v4PositionManager;
  const slippage = ctx.slippage ?? 0.01;
  const ttl = ctx.deadlineSeconds ?? 120;

  let dryRunTokenId = 0n;

  const send = async (call: UnsignedCall): Promise<{ hash: string; logs: RawLog[] }> => {
    const { hash } = await ctx.signer.send(call);

    // A dry run still builds and journals the real calldata, which is the whole
    // point of running one: the encoding is exercised against live pool state
    // before a key exists anywhere. What it cannot do is wait for a receipt for
    // a transaction nobody sent, so it answers with the receipt such a call
    // would have produced. This is the only invented value in this file and it
    // never reaches a chain.
    if (ctx.signer.dryRun) {
      dryRunTokenId += 1n;
      return {
        hash,
        logs: [
          {
            address: pm,
            topics: [
              TRANSFER_TOPIC,
              `0x${"0".repeat(64)}`,
              `0x${ctx.vault.slice(2).toLowerCase().padStart(64, "0")}`,
              `0x${dryRunTokenId.toString(16).padStart(64, "0")}`,
            ],
            data: "0x",
          },
        ],
      };
    }

    const receipt = await ctx.receipt(hash);
    if (receipt === null) {
      // Broadcast, outcome unknown. The one case that must not be recorded as
      // a failure. See the note at the top of this file.
      throw new Unconfirmed(
        `${call.description}: broadcast as ${hash}, no receipt`,
        hash,
      );
    }
    if (!receipt.ok) throw new Error(`${call.description}: reverted (${hash})`);
    return { hash, logs: receipt.logs };
  };

  return async function execute(intent: Intent): Promise<ExecutorResult> {
    const deadline = BigInt(ctx.now() + ttl);

    if (intent.kind === "open") {
      const found = ctx.poolFor(intent.pool);
      if (!found) throw new Error(`${intent.pool}: not a pool this desk can open`);

      // Read fresh. The band is centred on the price at submission, not on the
      // price the tick was decided from.
      const state = await ctx.readPool(found.key);
      const isLadder = intent.venueKind === "ladder";
      const { tickLower, tickUpper } = isLadder
        ? ladderTicks(state, intent.gap ?? 0.01, intent.width ?? 0.1)
        : bandTicks(state, intent.halfWidth);

      const quoteIsToken1 = !state.stockIsToken1;
      const quoteToken = quoteIsToken1 ? found.key.currency1 : found.key.currency0;
      const quoteDecimals = quoteIsToken1
        ? state.token1.decimals
        : state.token0.decimals;
      const quoteAmount = BigInt(
        Math.floor(intent.capital * 10 ** quoteDecimals),
      );

      const [balance0, balance1] = await Promise.all([
        ctx.balanceOf(found.key.currency0),
        ctx.balanceOf(found.key.currency1),
      ]);

      // A ladder is funded with the token alone, so it commits no quote at all.
      // Passing the quote amount here would let sizeMint bound it on a side the
      // position does not use, and a range above spot needs none of it.
      const sized = sizeMint({
        state,
        tickLower,
        tickUpper,
        quoteAmount: isLadder ? 0n : quoteAmount,
        balance0,
        balance1,
      });
      if (sized.liquidity <= 0n) {
        throw new Error(
          `${intent.pool}: ${intent.capital} of ${quoteToken} buys no liquidity at this range`,
        );
      }

      for (const approval of approvalsFor(
        { vault: ctx.vault, permit2: ctx.permit2, positionManager: pm },
        quoteToken,
        withSlippage(quoteAmount, slippage),
        ctx.now() + ttl,
      )) {
        await send(approval);
      }

      const { hash, logs } = await send(
        viaVault(
          ctx.vault,
          pm,
          planMint({
            key: found.key,
            tickLower,
            tickUpper,
            liquidity: sized.liquidity,
            amount0Max: withSlippage(sized.amount0, slippage),
            amount1Max: withSlippage(sized.amount1, slippage),
            owner: ctx.vault,
            deadline,
          }),
          `mint ${intent.pool} ${tickLower}..${tickUpper}`,
        ),
      );

      const tokenId = tokenIdFromLogs(logs, pm, ctx.vault);
      if (tokenId === null) {
        // The call succeeded and the desk cannot say what it owns. Treat it the
        // same as a lost receipt: go and look, do not assume.
        throw new Unconfirmed(
          `mint landed as ${hash} but no Transfer to the vault was found in it`,
          hash,
        );
      }

      return {
        handle: tokenId.toString(),
        amount: Number(sized.liquidity),
        txHash: hash,
      };
    }

    if (
      intent.kind === "sweep" ||
      intent.kind === "close" ||
      intent.kind === "rebalance"
    ) {
      const held = ctx.positionFor(intent.positionId);
      if (!held) throw new Error(`${intent.positionId}: not a position this desk holds`);

      if (intent.kind === "sweep") {
        const { hash } = await send(
          viaVault(
            ctx.vault,
            pm,
            planCollect({
              key: held.key,
              tokenId: held.tokenId,
              recipient: ctx.vault,
              deadline,
            }),
            `collect fees on ${intent.positionId}`,
          ),
        );
        // What was collected is read from the vault's balance change, which the
        // caller measures; reporting a figure from here would be a guess about
        // a number the chain already knows.
        return { txHash: hash };
      }

      if (intent.kind === "close") {
        const { hash } = await send(
          viaVault(
            ctx.vault,
            pm,
            planClose({
              key: held.key,
              tokenId: held.tokenId,
              // Closing a position that has moved against the desk is the point
              // of closing it, so a minimum here would refuse exactly the exits
              // that matter. The decision to close was already taken.
              amount0Min: 0n,
              amount1Min: 0n,
              recipient: ctx.vault,
              deadline,
            }),
            `close ${intent.positionId}`,
          ),
        );
        return { txHash: hash };
      }

      // Re-centre: burn and mint in one unlock, so the desk can never end up
      // holding inventory with no position.
      const state = await ctx.readPool(held.key);
      const { tickLower, tickUpper } = bandTicks(state, held.halfWidth);
      const [balance0, balance1] = await Promise.all([
        ctx.balanceOf(held.key.currency0),
        ctx.balanceOf(held.key.currency1),
      ]);
      const quoteIsToken1 = !state.stockIsToken1;
      const quoteDecimals = quoteIsToken1
        ? state.token1.decimals
        : state.token0.decimals;

      const sized = sizeMint({
        state,
        tickLower,
        tickUpper,
        quoteAmount: BigInt(Math.floor(held.capital * 10 ** quoteDecimals)),
        // The burn returns the old position's tokens inside the same unlock, so
        // the mint is not limited to what the vault is holding beforehand.
        balance0: balance0 + BigInt(2) ** BigInt(100),
        balance1: balance1 + BigInt(2) ** BigInt(100),
      });

      const { hash, logs } = await send(
        viaVault(
          ctx.vault,
          pm,
          planRecentre({
            key: held.key,
            tokenId: held.tokenId,
            amount0Min: 0n,
            amount1Min: 0n,
            tickLower,
            tickUpper,
            liquidity: sized.liquidity,
            amount0Max: withSlippage(sized.amount0, slippage),
            amount1Max: withSlippage(sized.amount1, slippage),
            owner: ctx.vault,
            deadline,
          }),
          `re-centre ${intent.positionId} to ${tickLower}..${tickUpper}`,
        ),
      );

      const tokenId = tokenIdFromLogs(logs, pm, ctx.vault);
      if (tokenId === null) {
        throw new Unconfirmed(
          `re-centre landed as ${hash} but no Transfer to the vault was found in it`,
          hash,
        );
      }
      return { handle: tokenId.toString(), txHash: hash };
    }

    if (intent.kind === "record") {
      const { hash } = await send({
        to: ctx.vault,
        data: VAULT.encodeFunctionData("recordRealized", [
          BigInt(Math.floor(intent.realized)),
        ]),
        description: "book realised profit",
      });
      return { txHash: hash };
    }

    if (intent.kind === "claim") {
      if (!ctx.ponsHook) {
        throw new Error("claim: no Pons hook configured, so there is nothing to sweep");
      }
      const call = (to: string, data: string) => ctx.call(to, data);
      const escrow = await escrowOf(call, ctx.ponsHook);
      const before = await balanceOfRaw(call, intent.token, ctx.vault);

      // The sweep moves fees from the hook into the escrow. It reverts for
      // anyone but Pons's own operator whenever an internal swap is needed, and
      // that revert is correct rather than a failure of ours: those fees are
      // theirs to convert. The claim still runs, for whatever is already
      // credited.
      try {
        const sweep = sweepCall(ctx.ponsHook, intent.poolId);
        await send(viaVault(ctx.vault, sweep.to, sweep.data, sweep.description));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Unconfirmed) throw error;
        console.warn(`  sweep into escrow did not land (${message}); claiming what is credited`);
      }

      const claim = claimCall(escrow, intent.token);
      const { hash } = await send(
        viaVault(ctx.vault, claim.to, claim.data, claim.description),
      );

      // The escrow implementation is not published, so that claimToken pays
      // msg.sender is an inference from its interface. Check it rather than
      // journal income the desk may not hold.
      const { ok, received } = await verifyClaim(call, intent.token, ctx.vault, before);
      if (!ok && !ctx.signer.dryRun) {
        throw new Error(
          `claim landed as ${hash} but the vault's balance did not rise. ` +
            "The escrow may not pay the caller; do not book this as income.",
        );
      }
      return { txHash: hash, amount: Number(received) };
    }

    throw new Error(`${intent.kind}: not implemented on this venue`);
  };
}
