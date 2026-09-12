/**
 * Run the keeper.
 *
 *   RESIDENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
 *     node --experimental-strip-types scripts/keeper.mjs
 *
 * Dry run by default, and there is no flag in this repository that makes it
 * anything else. Going live needs two things that are deliberately not here: a
 * signer (see src/lib/keeper/signer.ts — a KMS or HSM, never a key in a file)
 * and a venue executor that knows how to open a position on the venue you are
 * pointing it at. Until both exist the loop reads chains, ranks pools, and
 * writes down what it would have done.
 *
 * That journal is worth having on its own. Left running for a week it says
 * which positions the desk would have opened and when it would have moved
 * them, and those can be checked against what the pools actually paid before
 * any money is at risk.
 *
 *   --once             one interval, then exit
 *   --interval=60      seconds between ticks (default 60)
 *   --journal=PATH     where to append (default .keeper/dry-run.ndjson)
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

import { FileJournal } from "../src/lib/keeper/journal-file.ts";
import { checkJournalVolume, volumeFailure } from "../src/lib/keeper/volume.ts";
import { readPosition } from "../src/lib/keeper/position-reader.ts";
import { observePosition, toUnits } from "../src/lib/keeper/observer.ts";
import {
  readBalance,
  readInventory,
  readVaultLedger,
  readVaultRoles,
} from "../src/lib/keeper/vault-reader.ts";
import { seriesFrom } from "../src/lib/keeper/marks.ts";
import { claimable as claimableOf, escrowOf, pending as pendingOf } from "../src/lib/keeper/pons.ts";
import { poolId as poolIdOf } from "../src/lib/sim/v4.ts";
import { bandWidth } from "../src/lib/sim/strategy.ts";
import { keccak256, solidityPacked, verifyMessage } from "ethers";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { BadOrder, Control, parseOrder } from "../src/lib/keeper/control.ts";
import { DryRunSigner, SimulatingSigner } from "../src/lib/keeper/signer.ts";
import { addressOf, localSigner } from "../src/lib/keeper/signer-local.ts";
import { dryRunExecutor } from "../src/lib/keeper/executor-dryrun.ts";
import { makeV4Executor } from "../src/lib/keeper/executor-v4.ts";
import { makeV4Reconciler } from "../src/lib/keeper/reconcile-v4.ts";
import { jsonRpc, receiptWaiter } from "../src/lib/keeper/tx.ts";
import { readV4Pool, rpcReader } from "../src/lib/sim/v4.ts";
import { TOKENS, UNISWAP } from "../src/lib/chain.ts";
import { DEFAULT_TICK, tick } from "../src/lib/keeper/loop.ts";
import { loadState } from "../src/lib/keeper/registry.ts";
import { ledgerFrom, ledgerTotals } from "../src/lib/keeper/ledger.ts";
import { RpcPoolsSource, discoverPools } from "../src/lib/desk/rpc-pools-source.ts";
import { realisedVolatility } from "../src/lib/sim/strategy.ts";
import { liquidityInBand } from "../src/lib/sim/opportunity.ts";

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const RPC = process.env.RESIDENT_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
if (!RPC) {
  console.error(
    "Set RESIDENT_RPC_URL to an RPC that can serve eth_getLogs.\n" +
      "The keeper reads volume, pool age and price history from Swap and " +
      "Initialize logs; there is nothing useful it can do without one.",
  );
  process.exit(1);
}

const journalPath = arg(
  "journal",
  process.env.RESIDENT_JOURNAL ?? ".keeper/dry-run.ndjson",
);
/**
 * Refuse to start if the journal would not survive a redeploy.
 *
 * Only when RESIDENT_REQUIRE_VOLUME says to, which the container image sets and
 * a laptop does not. The Dockerfile used to declare this with a VOLUME
 * directive; Railway rejects a Dockerfile that has one, and a VOLUME directive
 * enforced nothing anyway. This asks the filesystem instead.
 */
if (process.env.RESIDENT_REQUIRE_VOLUME === "1") {
  const verdict = checkJournalVolume(journalPath, (path) => {
    try {
      return statSync(path).dev;
    } catch {
      return null;
    }
  });
  if (!verdict.durable) {
    console.error(`\n${volumeFailure(journalPath, verdict)}\n`);
    process.exit(1);
  }
  console.log(`  volume    ${verdict.mountPoint} (durable)`);
}

const intervalSeconds = Number(arg("interval", "60"));
const once = process.argv.includes("--once");

const CACHE = ".pools.json";
let watched;
if (existsSync(CACHE)) {
  watched = JSON.parse(readFileSync(CACHE, "utf8"));
} else {
  process.stdout.write("  scanning Initialize logs… ");
  watched = await discoverPools(RPC);
  writeFileSync(CACHE, JSON.stringify(watched, null, 2));
  console.log(`found ${watched.length} pools`);
}

const source = new RpcPoolsSource(RPC, watched);
const journal = new FileJournal(journalPath);
const rpc = jsonRpc(RPC);

/**
 * A key, or nothing.
 *
 * Three modes, in the order they should be used:
 *
 *   neither variable set        every call is built and journalled, nothing is
 *                               sent and nothing is checked
 *   RESIDENT_KEEPER_ADDRESS     every call is built and put to the node as
 *                               eth_estimateGas, so a mint that would revert
 *                               says so before a key exists anywhere
 *   RESIDENT_KEEPER_KEY         it signs, and refuses mainnet unless
 *                               RESIDENT_ALLOW_MAINNET says that is intended,
 *                               checked against the chain id the node reports
 *                               on every transaction rather than once at start
 *
 * The middle one needs the keeper's address and not its key. Take the address
 * from `npm run newkey` and leave the key wherever it is until it is clean.
 */
const KEY = process.env.RESIDENT_KEEPER_KEY;
const KEEPER_ADDRESS = process.env.RESIDENT_KEEPER_ADDRESS;
const signer = KEY
  ? localSigner({
      rpc,
      key: KEY,
      allowMainnet: process.env.RESIDENT_ALLOW_MAINNET === "1",
      expectedChainId: process.env.RESIDENT_CHAIN_ID
        ? Number(process.env.RESIDENT_CHAIN_ID)
        : undefined,
    })
  : KEEPER_ADDRESS
    ? // Address without key: every call is built for real and put to the node
      // as eth_estimateGas, which reverts wherever a real send would. This is
      // the step between "the encoding looks right" and "the chain agrees",
      // and it costs nothing but a round trip.
      new SimulatingSigner(rpc, KEEPER_ADDRESS)
    : new DryRunSigner();
const reader = rpcReader(RPC);

const VAULT = process.env.RESIDENT_VAULT;

/**
 * The asset every figure in the decision engine is denominated in.
 *
 * Idle capital, position values, fee income and the vault ledger all have to be
 * in the same unit or the rules compare numbers that only look comparable.
 */
const QUOTE = {
  address: process.env.RESIDENT_USDG ?? TOKENS.usdg,
  decimals: Number(process.env.RESIDENT_USDG_DECIMALS ?? 6),
};

/**
 * With a vault address the desk builds the real thing: real pool state, real
 * tick maths, real calldata for the position manager, all of it journalled.
 * The signer is still a dry run, so none of it is sent. That is the run worth
 * leaving on for a week before a key exists anywhere, because it is the only
 * way to find out that the encoding is wrong without paying for the discovery.
 *
 * Without a vault address there is nothing to encode a call against, so the
 * loop falls back to an executor that answers without building anything.
 */
const byName = new Map(
  watched.map((w) => [`${w.token0.symbol}/${w.token1.symbol}`, w]),
);

const execute = VAULT
  ? makeV4Executor({
      vault: VAULT,
      positionManager: process.env.RESIDENT_V4_POSITION_MANAGER ?? UNISWAP.v4PositionManager,
      permit2: process.env.RESIDENT_PERMIT2 ?? UNISWAP.permit2,
      ponsHook: process.env.RESIDENT_PONS_HOOK,
      call: (to, data) => rpc("eth_call", [{ to, data }, "latest"]),
      poolFor: (name) => {
        const w = byName.get(name);
        return w ? { key: w.key, state: null } : null;
      },
      positionFor: () => null,
      readPool: (key) => {
        const w = [...byName.values()].find((x) => x.key === key);
        return readV4Pool(reader, key, w.token0, w.token1);
      },
      /**
       * What the vault actually holds of a token, read from the chain.
       *
       * This caps every mint. Returning a number larger than the balance does
       * not fail cheaply: the position manager pulls what the plan says and
       * reverts after the gas is spent.
       */
      balanceOf: async (token) => {
        const data =
          "0x70a08231" + VAULT.slice(2).toLowerCase().padStart(64, "0");
        const result = await rpc("eth_call", [{ to: token, data }, "latest"]);
        return result && result !== "0x" ? BigInt(result) : 0n;
      },
      receipt: receiptWaiter(rpc),
      signer,
      now: () => Math.floor(Date.now() / 1000),
    })
  : dryRunExecutor();

/**
 * Turn live pool observations into the board the scanner ranks.
 *
 * Volatility comes from the sampled price track rather than a constant: the
 * scanner refuses a pool without it, so a pool whose history is too short to
 * measure is skipped and reported rather than priced as calm.
 */
function toScannedPools(observations) {
  const pools = [];
  for (const obs of observations) {
    const prices = obs.prices ?? [];
    if (prices.length < 20) continue;
    const volatility = realisedVolatility(prices);
    if (!(volatility > 0)) continue;

    // Both figures are in whatever the pool is quoted in, and the sizing and
    // allocation rules below are in dollars. A pool whose quote could not be
    // priced is skipped rather than converted at a made-up rate.
    const usd = obs.quoteUsd;
    if (!(usd > 0)) continue;

    pools.push({
      name: `${obs.pool.token0.symbol}/${obs.pool.token1.symbol}`,
      chain: "robinhood",
      kind: "band",
      volume: (obs.volume.h1 / 60) * usd,
      volatility,
      liquidity: liquidityInBand(obs.pool, 0.05) * usd,
      feePips: obs.pool.fee,
      prices,
    });
  }
  return pools;
}

const deps = {
  signer,
  execute,
  reconcile: VAULT
    ? makeV4Reconciler({
        journal,
        receipt: receiptWaiter(rpc, 0),
        positionManager: process.env.RESIDENT_V4_POSITION_MANAGER ?? UNISWAP.v4PositionManager,
        vault: VAULT,
      })
    : async () => ({ found: null }),
  observe: async () => {
    const observations = await source.observe();
    const pools = toScannedPools(observations);

    // Without a vault there is nothing to read a balance or a position from,
    // and inventing either would put the decision engine to work on fiction.
    if (!VAULT) {
      return {
        pools,
        positions: [],
        current: null,
        idleCapital: Number(process.env.RESIDENT_DRY_CAPITAL ?? 0),
        inventory: [],
        unbookedProfit: 0,
        unbookedLoss: 0,
        owed: 0,
        bridges: {},
        vault: { owner: "0x", keeper: "0x" },
      };
    }

    const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
    const byPool = new Map(pools.map((p) => [p.name, p]));
    const observed = new Map(
      observations.map((o) => [`${o.pool.token0.symbol}/${o.pool.token1.symbol}`, o]),
    );

    const [roles, ledger, records] = await Promise.all([
      readVaultRoles(call, VAULT),
      readVaultLedger(call, VAULT, QUOTE.decimals),
      journal.read(),
    ]);
    const series = seriesFrom(records);
    const state = await loadState(journal);

    // Idle capital is the vault's own quote balance. Anything that arrives —
    // a sweep landing, a fee claim, a deposit — is deployable on the next tick
    // without anything else having to know where it came from.
    const idleCapital = toUnits(
      await readBalance(call, QUOTE.address, VAULT),
      QUOTE.decimals,
    );

    const positions = [];
    for (const position of state.positions) {
      const board = byPool.get(position.pool);
      const obs = observed.get(position.pool);
      if (!board || !obs) continue;
      try {
        const read = await readPosition(
          {
            call,
            positionManager: process.env.RESIDENT_V4_POSITION_MANAGER ?? UNISWAP.v4PositionManager,
            stateView: process.env.RESIDENT_V4_STATE_VIEW ?? UNISWAP.v4StateView,
            poolIdOf,
            keccakPacked: (owner, lower, upper, salt) =>
              keccak256(
                solidityPacked(
                  ["address", "int24", "int24", "bytes32"],
                  [owner, lower, upper, salt],
                ),
              ),
          },
          position.handle,
        );
        const price = board.prices.at(-1) ?? 0;
        positions.push(
          observePosition({
            position,
            read,
            price,
            decimals0: obs.pool.token0.decimals,
            decimals1: obs.pool.token1.decimals,
            quoteIsToken1: obs.pool.stockIsToken1 !== true,
            volume: board.volume,
            liquidity: board.liquidity,
            volatility: board.volatility,
            captureEfficiency: DEFAULT_TICK.decide.scan.capture.unmeasured,
            freshHalfWidth: bandWidth(board.volatility),
            series: series.get(position.id),
            now: Date.now(),
            intervalMs: intervalSeconds * 1000,
          }),
        );
      } catch (error) {
        // One unreadable position must not blind the keeper to the rest of its
        // book. It is reported and left out, so nothing decides about it.
        console.error(
          `  could not read position ${position.id} (${position.handle}): ${error.message}`,
        );
      }
    }

    // What the operator sees when deciding whether to close something. Plain
    // values, and the same numbers the rules just decided on rather than a
    // second reading that could disagree with them.
    lastReport = {
      ...lastReport,
      positions: positions.map((p) => {
        const held = state.positions.find((x) => x.id === p.positionId);
        return {
          id: p.positionId,
          pool: held?.pool ?? "?",
          handle: held?.handle ?? "",
          value: p.value,
          feesUnclaimed: p.feesUnclaimed,
          unrealised: p.unrealised,
          price: p.price,
          currentRate: p.currentRate,
          inRange: p.currentRate !== 0,
          ageIntervals: p.ageIntervals,
        };
      }),
    };

    // The launch's own fees. Absent rather than zero when no launch is
    // configured: a desk with no launch should say nothing about claiming.
    let launchFees;
    const hook = process.env.RESIDENT_PONS_HOOK;
    const launchPool = process.env.RESIDENT_RES_POOL_ID;
    if (hook && launchPool) {
      try {
        const escrow = await escrowOf(call, hook);
        const [credited, onHook] = await Promise.all([
          claimableOf(call, escrow, VAULT, QUOTE.address),
          pendingOf(call, hook, launchPool, QUOTE.address),
        ]);
        launchFees = {
          poolId: launchPool,
          token: QUOTE.address,
          claimable: toUnits(credited, QUOTE.decimals),
          pending: toUnits(onHook, QUOTE.decimals),
        };
      } catch (error) {
        // A launch that cannot be read is reported, not guessed at. Reporting
        // zero here would look like "no fees" and quietly stop the inflow.
        console.error(`  could not read launch fees: ${error.message}`);
      }
    }

    // Loose tokens the desk holds, for the ladder rule. Priced off the same
    // board the scanner ranks, so a token with no live pool is not inventory.
    const inventory = await readInventory(
      call,
      VAULT,
      [...observed.entries()]
        .filter(([name]) => byPool.has(name))
        .map(([name, o]) => ({
          pool: name,
          address: o.pool.stockIsToken1 ? o.pool.token1.address : o.pool.token0.address,
          decimals: o.pool.stockIsToken1
            ? o.pool.token1.decimals
            : o.pool.token0.decimals,
          price: byPool.get(name).prices.at(-1) ?? 0,
        }))
        .filter((t) => t.address && t.price > 0),
    );

    // Profit the desk has banked but the contract has not been told about yet.
    // The ledger is the record of what has been booked; the difference is what
    // the record intent exists to close.
    const banked = state.sweptTotal;
    const unbookedProfit = Math.max(0, banked - ledger.realized);

    return {
      pools,
      positions,
      current: null,
      // Drained here so it happens exactly once per tick, whatever else the
      // loop does. An order taken twice is a position closed twice.
      manual: control?.drain() ?? [],
      paused: control?.paused ?? false,
      launchFees,
      idleCapital,
      inventory,
      unbookedProfit,
      unbookedLoss: 0,
      owed: ledger.owed,
      bridges: {},
      vault: { owner: roles.owner, keeper: roles.keeper },
    };
  },
};

/** The last tick's summary, served to the dashboard. Replaced every tick. */
let lastReport = { positions: [], board: [], idleCapital: 0, at: 0 };

/**
 * The operator's way in.
 *
 * Off unless RESIDENT_CONTROL_WALLET names an address. Authority is a signature
 * from that wallet and nothing else: there is no shared secret to leak, and
 * revoking access is a wallet change rather than a redeploy.
 *
 * Orders are queued and applied at the top of the next tick, as the same
 * intents the rules emit. A manual close is journalled, submitted and
 * reconciled exactly as an automatic one is.
 */
const CONTROL_WALLET = process.env.RESIDENT_CONTROL_WALLET;
const control = CONTROL_WALLET
  ? new Control({
      wallet: CONTROL_WALLET,
      verify: verifyMessage,
      random: () => randomBytes(32).toString("hex"),
      now: () => Date.now(),
    })
  : null;

if (control) {
  const origin = process.env.RESIDENT_CONTROL_ORIGIN ?? "*";
  const port = Number(process.env.PORT ?? 8080);

  const send = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      // The book is not something to hand to a cache or a crawler.
      "cache-control": "no-store",
    });
    res.end(payload);
  };

  const bodyOf = (req) =>
    new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        // A control endpoint has no reason to accept a large body, and an
        // unbounded one is a way to exhaust a small container.
        if (raw.length > 8192) reject(new BadOrder("body too large"));
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new BadOrder("body is not JSON"));
        }
      });
      req.on("error", reject);
    });

  const bearer = (req) => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : null;
  };

  createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/control/nonce") {
        const { nonce, message, expiresAt } = control.begin();
        return send(res, 200, { nonce, message, expiresAt });
      }

      if (req.method === "POST" && url.pathname === "/control/session") {
        const body = await bodyOf(req);
        const session = control.authenticate(String(body.nonce ?? ""), String(body.signature ?? ""));
        return send(res, 200, session);
      }

      if (!control.authorised(bearer(req))) {
        return send(res, 401, { error: "sign in with the desk wallet" });
      }

      if (req.method === "GET" && url.pathname === "/control/state") {
        return send(res, 200, {
          paused: control.paused,
          pending: control.pending,
          ...lastReport,
        });
      }

      if (req.method === "POST" && url.pathname === "/control/order") {
        const order = parseOrder(await bodyOf(req));
        control.submit(order);
        console.log(`  order     ${order.kind} ${JSON.stringify(order)}`);
        return send(res, 202, { queued: order, paused: control.paused });
      }

      return send(res, 404, { error: "no such endpoint" });
    } catch (error) {
      const bad = error instanceof BadOrder || error?.name === "BadOrder";
      return send(res, bad ? 400 : 500, { error: error.message ?? "failed" });
    }
  }).listen(port, () => {
    console.log(`  control   :${port}, wallet ${control.wallet}`);
  });
}

console.log(`  journal   ${journalPath}`);
console.log(`  vault     ${VAULT ?? "unset (no calldata will be built)"}`);
console.log(`  signer    ${signer.description}`);
if (KEY) {
  console.log(`  keeper    ${addressOf(KEY)}`);
  console.log(
    "            this address must be the vault's keeper and must NOT be its\n" +
      "            owner. The loop checks both against the chain every tick.",
  );
}
console.log(`  interval  ${intervalSeconds}s${once ? " (once)" : ""}`);
console.log("");

async function runOnce() {
  const report = await tick(deps, journal, DEFAULT_TICK);
  const when = new Date(report.at).toISOString().slice(11, 19);

  // What the dashboard reads. Values only: it is served to a browser, and
  // nothing here should be a live handle into the keeper's state.
  lastReport = {
    at: report.at,
    halted: report.halted ?? null,
    idleCapital: report.scan?.capital ?? 0,
    board: (report.scan?.ranked ?? []).slice(0, 12).map((r) => ({
      pool: r.pool.name,
      netApr: r.netApr,
      eligible: r.eligible,
      blockedBy: r.blockedBy,
      capital: r.capital,
      halfWidth: r.halfWidth,
      capture: r.capture.efficiency,
      captureSource: r.capture.source,
    })),
    intents: report.intents.map((i) => ({ kind: i.kind, reason: i.reason })),
  };

  if (report.halted) {
    console.log(`${when}  halted: ${report.halted}`);
    return;
  }

  const ranked = report.scan?.ranked ?? [];
  const eligible = ranked.filter((r) => r.eligible);
  console.log(
    `${when}  ${ranked.length} pools, ${eligible.length} eligible, ` +
      `${report.intents.length} intents`,
  );
  for (const r of eligible.slice(0, 5)) {
    console.log(
      `          ${r.pool.name.padEnd(16)} ${(r.netApr * 100).toFixed(1)}% APR  ${r.reason}`,
    );
  }
  for (const result of report.results) {
    console.log(
      `          ${result.ok ? "→" : "×"} ${result.intent.kind}: ${result.intent.reason}`,
    );
  }
  if (report.scan?.skipped.length) {
    console.log(`          ${report.scan.skipped.length} skipped (unpriceable)`);
  }
}

await runOnce();

if (!once) {
  const timer = setInterval(runOnce, intervalSeconds * 1000);
  process.on("SIGINT", async () => {
    clearInterval(timer);
    const state = await loadState(journal);
    const totals = ledgerTotals(ledgerFrom(await journal.read()));
    console.log(
      `\n  ${state.positions.length} positions, ${totals.closed} closed, ` +
        `${totals.feesSwept.toFixed(2)} in fees — all of it hypothetical.`,
    );
    process.exit(0);
  });
}
