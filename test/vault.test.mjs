/**
 * ResidentVault — one test per property the site claims, plus the ledger
 * identity and the rate limiter.
 *
 * Run: node --test test/
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Chain, compile } from "./harness.mjs";

const { artifacts, warnings } = compile();
if (warnings.length) {
  console.log(`solc warnings: ${warnings.length}`);
}

const USDG = 10n ** 6n; // 6dp, as USDG
const CAP = 1_000_000n * USDG;

/** Fresh vault, funded, one venue allowlisted. */
async function fixture() {
  const chain = await Chain.create(artifacts);
  const [deployer, keeper, holderA, holderB, outsider] = chain.wallets;

  const usdg = await chain.deploy("MockERC20", ["USDG", "USDG", 6]);
  const stock = await chain.deploy("MockERC20", ["AMC Token", "AMC", 18]);
  const venue = await chain.deploy("MockVenue", []);
  const vault = await chain.deploy("ResidentVault", [
    deployer.hex,
    keeper.hex,
    usdg.hex,
  ]);

  await chain.call(usdg, "mint", [vault.hex, 10_000_000n * USDG]);
  await chain.call(vault, "setVenue", [venue.hex, true], { from: deployer });
  await chain.call(vault, "setCap", [usdg.hex, CAP], { from: deployer });

  return { chain, deployer, keeper, holderA, holderB, outsider, usdg, stock, venue, vault };
}

// --- Invariant: the keeper trades only sanctioned venues -------------------

test("exec routes through an allowlisted venue", async () => {
  const { chain, keeper, usdg, stock, venue, vault } = await fixture();

  await chain.call(vault, "approveVenue", [usdg.hex, venue.hex, 1_000n * USDG], { from: keeper });
  const data = venue.iface.encodeFunctionData("swap", [
    usdg.hex, stock.hex, 1_000n * USDG, 5n * 10n ** 18n,
  ]);
  const res = await chain.call(vault, "exec", [venue.hex, 0n, data], { from: keeper });

  assert.equal(res.ok, true, `exec reverted: ${res.error}`);
  assert.equal(await chain.read(stock, "balanceOf", [vault.hex]), 5n * 10n ** 18n);
});

test("exec reverts on any target outside the allowlist", async () => {
  const { chain, keeper, usdg, stock, vault } = await fixture();
  const rogue = await chain.deploy("MockVenue", []);
  const data = rogue.iface.encodeFunctionData("swap", [usdg.hex, stock.hex, 1n, 1n]);

  const res = await chain.call(vault, "exec", [rogue.hex, 0n, data], { from: keeper });
  assert.equal(res.ok, false);
  assert.equal(res.error, "VenueNotAllowed");
});

test("exec cannot reach a token transfer even if the token is allowlisted", async () => {
  const { chain, deployer, keeper, outsider, usdg, vault } = await fixture();
  // Deliberate misconfiguration: allowlist the token itself as a venue.
  await chain.call(vault, "setVenue", [usdg.hex, true], { from: deployer });

  const drain = usdg.iface.encodeFunctionData("transfer", [outsider.hex, 10_000_000n * USDG]);
  const res = await chain.call(vault, "exec", [usdg.hex, 0n, drain], { from: keeper });

  assert.equal(res.ok, false, "a misconfigured allowlist must not become a drain");
  assert.equal(res.error, "ForbiddenSelector");
  assert.equal(await chain.read(usdg, "balanceOf", [outsider.hex]), 0n);
});

test("only the keeper can exec", async () => {
  const { chain, outsider, venue, vault } = await fixture();
  const data = venue.iface.encodeFunctionData("boom", []);
  const res = await chain.call(vault, "exec", [venue.hex, 0n, data], { from: outsider });
  assert.equal(res.error, "NotKeeper");
});

test("a failing venue call bubbles up rather than silently succeeding", async () => {
  const { chain, keeper, venue, vault } = await fixture();
  const data = venue.iface.encodeFunctionData("boom", []);
  const res = await chain.call(vault, "exec", [venue.hex, 0n, data], { from: keeper });
  assert.equal(res.ok, false);
});

// --- Invariant: approvals cannot leak --------------------------------------

test("approvals are spender-gated to the venue allowlist", async () => {
  const { chain, keeper, outsider, usdg, vault } = await fixture();
  const res = await chain.call(vault, "approveVenue", [usdg.hex, outsider.hex, 1n], { from: keeper });
  assert.equal(res.error, "VenueNotAllowed");
  assert.equal(await chain.read(usdg, "allowance", [vault.hex, outsider.hex]), 0n);
});

// --- The profit ledger ------------------------------------------------------

test("15% accrues to holders and 85% becomes working capital", async () => {
  const { chain, keeper, vault } = await fixture();

  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  assert.equal(await chain.read(vault, "owed", []), 150n * USDG);
  assert.equal(await chain.read(vault, "workingCapital", []), 850n * USDG);

  // Reported cumulatively, so the split applies to the delta only.
  await chain.call(vault, "recordRealized", [1_400n * USDG], { from: keeper });
  assert.equal(await chain.read(vault, "owed", []), 210n * USDG);
  assert.equal(await chain.read(vault, "workingCapital", []), 1_190n * USDG);
});

test("realized profit is monotonic — a keeper cannot retract a report", async () => {
  const { chain, keeper, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  const res = await chain.call(vault, "recordRealized", [900n * USDG], { from: keeper });
  assert.equal(res.error, "ProfitNotMonotonic");
  assert.equal(await chain.read(vault, "realized", []), 1_000n * USDG);
});

test("replaying a report is idempotent rather than double-counting", async () => {
  const { chain, keeper, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  assert.equal(await chain.read(vault, "owed", []), 150n * USDG);
});

test("owed carries forward across distributions and never resets", async () => {
  const { chain, keeper, holderA, holderB, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });

  await chain.call(vault, "distribute", [[holderA.hex], [100n * USDG]], { from: keeper });
  assert.equal(await chain.read(vault, "owed", []), 50n * USDG);

  await chain.call(vault, "recordRealized", [2_000n * USDG], { from: keeper });
  // 15% of 2000 accrued, less 100 paid
  assert.equal(await chain.read(vault, "owed", []), 200n * USDG);

  await chain.call(vault, "distribute", [[holderB.hex], [200n * USDG]], { from: keeper });
  assert.equal(await chain.read(vault, "owed", []), 0n);
  assert.equal(await chain.read(vault, "distributed", []), 300n * USDG);
});

test("a position loss falls on working capital, not on what holders are owed", async () => {
  const { chain, keeper, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  const owedBefore = await chain.read(vault, "owed", []);

  await chain.call(vault, "absorbLoss", [200n * USDG, "band closed below cost"], { from: keeper });

  assert.equal(await chain.read(vault, "workingCapital", []), 650n * USDG);
  assert.equal(await chain.read(vault, "owed", []), owedBefore, "holders must be untouched");
});

test("working capital cannot be driven below zero", async () => {
  const { chain, keeper, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  const res = await chain.call(vault, "absorbLoss", [900n * USDG, "too much"], { from: keeper });
  assert.equal(res.error, "WorkingCapitalExhausted");
});

test("a loss stops future accrual without clawing back past accrual", async () => {
  const { chain, keeper, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  await chain.call(vault, "absorbLoss", [800n * USDG, "drawdown"], { from: keeper });

  // What holders already earned survives the loss...
  assert.equal(await chain.read(vault, "owed", []), 150n * USDG);
  // ...but a desk that is not making money records no new profit to split.
  assert.equal(await chain.read(vault, "workingCapital", []), 50n * USDG);
});

// --- Distribution -----------------------------------------------------------

test("distribution pays holders pro-rata and books the total", async () => {
  const { chain, keeper, holderA, holderB, usdg, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });

  // 150 owed, split 2:1
  const res = await chain.call(
    vault, "distribute", [[holderA.hex, holderB.hex], [100n * USDG, 50n * USDG]],
    { from: keeper },
  );

  assert.equal(res.ok, true, `distribute reverted: ${res.error}`);
  assert.equal(await chain.read(usdg, "balanceOf", [holderA.hex]), 100n * USDG);
  assert.equal(await chain.read(usdg, "balanceOf", [holderB.hex]), 50n * USDG);
  assert.equal(await chain.read(vault, "owed", []), 0n);
});

test("distribution cannot exceed what is owed", async () => {
  const { chain, keeper, holderA, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });

  const res = await chain.call(vault, "distribute", [[holderA.hex], [151n * USDG]], { from: keeper });
  assert.equal(res.error, "ExceedsOwed", "working capital must be unreachable by distribution");
});

test("distribution cannot be called by anyone but the keeper", async () => {
  const { chain, keeper, outsider, holderA, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  const res = await chain.call(vault, "distribute", [[holderA.hex], [1n]], { from: outsider });
  assert.equal(res.error, "NotKeeper");
});

test("mismatched recipient and amount arrays revert", async () => {
  const { chain, keeper, holderA, holderB, vault } = await fixture();
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  const res = await chain.call(
    vault, "distribute", [[holderA.hex, holderB.hex], [1n]], { from: keeper },
  );
  assert.equal(res.error, "LengthMismatch");
});

// --- Invariant: distribution is rate-limited --------------------------------

test("the rolling cap blocks a payout beyond the window allowance", async () => {
  const { chain, keeper, holderA, vault } = await fixture();
  await chain.call(vault, "recordRealized", [20_000_000n * USDG], { from: keeper });

  // Cap is 1,000,000 per 24h.
  const ok = await chain.call(vault, "distribute", [[holderA.hex], [CAP]], { from: keeper });
  assert.equal(ok.ok, true, `first distribution reverted: ${ok.error}`);
  assert.equal(await chain.read(vault, "rateLimitRemaining", [await chain.read(vault, "payoutAsset", [])]), 0n);

  const blocked = await chain.call(vault, "distribute", [[holderA.hex], [1n * USDG]], { from: keeper });
  assert.equal(blocked.error, "ExceedsRateLimit");
});

test("the cap refills continuously rather than resetting on a boundary", async () => {
  const { chain, keeper, holderA, usdg, vault } = await fixture();
  await chain.call(vault, "recordRealized", [20_000_000n * USDG], { from: keeper });
  await chain.call(vault, "distribute", [[holderA.hex], [CAP]], { from: keeper });

  chain.warp(6 * 60 * 60); // quarter of the window
  const remaining = await chain.read(vault, "rateLimitRemaining", [usdg.hex]);
  const quarter = CAP / 4n;
  const drift = remaining > quarter ? remaining - quarter : quarter - remaining;
  assert.ok(drift <= CAP / 1000n, `expected ~25% refilled, got ${remaining}`);

  chain.warp(18 * 60 * 60); // the rest of the window
  assert.equal(await chain.read(vault, "rateLimitRemaining", [usdg.hex]), CAP);
});

// --- Invariant: the keeper is replaceable, custody unaffected ---------------

test("keeper rotation is one transaction and does not move custody", async () => {
  const { chain, deployer, keeper, outsider, usdg, vault } = await fixture();
  const before = await chain.read(usdg, "balanceOf", [vault.hex]);

  await chain.call(vault, "rotateKeeper", [outsider.hex], { from: deployer });

  assert.equal(
    (await chain.read(vault, "keeper", [])).toLowerCase(),
    outsider.hex.toLowerCase(),
  );
  assert.equal(await chain.read(usdg, "balanceOf", [vault.hex]), before, "custody must be unaffected");

  // The old keeper is immediately powerless; the new one works.
  const old = await chain.call(vault, "recordRealized", [1n], { from: keeper });
  assert.equal(old.error, "NotKeeper");
  const next = await chain.call(vault, "recordRealized", [1n], { from: outsider });
  assert.equal(next.ok, true);
});

test("the keeper cannot rotate itself or change the allowlist", async () => {
  const { chain, keeper, outsider, vault } = await fixture();
  assert.equal((await chain.call(vault, "rotateKeeper", [outsider.hex], { from: keeper })).error, "NotOwner");
  assert.equal((await chain.call(vault, "setVenue", [outsider.hex, true], { from: keeper })).error, "NotOwner");
  assert.equal((await chain.call(vault, "setCap", [outsider.hex, 1n], { from: keeper })).error, "NotOwner");
});

// --- Invariant: the owner can withdraw, the keeper cannot -------------------

test("the owner can withdraw any asset with no timelock", async () => {
  const { chain, deployer, outsider, usdg, vault } = await fixture();
  const all = await chain.read(usdg, "balanceOf", [vault.hex]);

  const res = await chain.call(vault, "withdraw", [usdg.hex, outsider.hex, all], { from: deployer });

  assert.equal(res.ok, true, `withdraw reverted: ${res.error}`);
  assert.equal(await chain.read(usdg, "balanceOf", [outsider.hex]), all);
  assert.equal(await chain.read(usdg, "balanceOf", [vault.hex]), 0n);
});

test("the keeper cannot withdraw", async () => {
  const { chain, keeper, usdg, vault } = await fixture();
  const res = await chain.call(vault, "withdraw", [usdg.hex, keeper.hex, 1n], { from: keeper });
  assert.equal(res.error, "NotOwner");
});

// --- Regression: a loss must not make later profit reports credit holders twice

test("a reserve draw does not inflate owed when profit is next reported", async () => {
  const { chain, keeper, vault } = await fixture();

  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });
  const owedBefore = await chain.read(vault, "owed", []);
  assert.equal(owedBefore, 150n * USDG);

  await chain.call(vault, "absorbLoss", [200n * USDG, "band closed below"], { from: keeper });

  // The keeper's own books still say lifetime realized profit is 1,000. Its next
  // report is that same cumulative figure. Absorbing a loss must not turn that
  // into new profit for holders.
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });

  assert.equal(
    await chain.read(vault, "owed", []),
    owedBefore,
    "re-reporting the same cumulative total after a draw must be a no-op",
  );
});

test("distribution is blocked until the owner sets a cap", async () => {
  const chain = await Chain.create(artifacts);
  const [deployer, keeper, holderA] = chain.wallets;
  const usdg = await chain.deploy("MockERC20", ["USDG", "USDG", 6]);
  const vault = await chain.deploy("ResidentVault", [deployer.hex, keeper.hex, usdg.hex]);
  await chain.call(usdg, "mint", [vault.hex, 1_000_000n * USDG]);
  await chain.call(vault, "recordRealized", [1_000n * USDG], { from: keeper });

  // No setCap yet: the limit defaults to zero.
  const res = await chain.call(vault, "distribute", [[holderA.hex], [1n * USDG]], { from: keeper });
  assert.equal(res.error, "ExceedsRateLimit", "a fresh vault must not pay out before a cap is chosen");
});

// --- LP band positions ------------------------------------------------------
// Uniswap v3 liquidity is an ERC721, so a vault that cannot receive one cannot
// hold a band at all.

test("the vault accepts an LP position from an allowlisted position manager", async () => {
  const { chain, deployer, vault } = await fixture();
  const manager = await chain.deploy("MockPositionManager", []);
  await chain.call(vault, "setVenue", [manager.hex, true], { from: deployer });

  const res = await chain.call(manager, "mint", [vault.hex]);

  assert.equal(res.ok, true, `mint reverted: ${res.error}`);
  assert.equal((await chain.read(manager, "ownerOf", [1n])).toLowerCase(), vault.hex.toLowerCase());
});

test("a position from an unsanctioned collection is refused", async () => {
  const { chain, vault } = await fixture();
  const rogue = await chain.deploy("MockPositionManager", []);
  // Not allowlisted: the vault must not accept arbitrary NFTs.
  const res = await chain.call(rogue, "mint", [vault.hex]);
  assert.equal(res.ok, false, "the vault must refuse an unsanctioned position");
});

test("the vault advertises the ERC721 receiver interface", async () => {
  const { chain, vault } = await fixture();
  assert.equal(await chain.read(vault, "supportsInterface", ["0x150b7a02"]), true);
  assert.equal(await chain.read(vault, "supportsInterface", ["0xffffffff"]), false);
});

test("band capital reaches a position manager through the allowlist", async () => {
  const { chain, deployer, keeper, usdg, vault } = await fixture();
  const manager = await chain.deploy("MockPositionManager", []);
  await chain.call(vault, "setVenue", [manager.hex, true], { from: deployer });

  // The keeper approves the manager, which is how a band gets funded.
  const res = await chain.call(vault, "approveVenue", [usdg.hex, manager.hex, 10_000n * USDG], { from: keeper });
  assert.equal(res.ok, true);
  assert.equal(await chain.read(usdg, "allowance", [vault.hex, manager.hex]), 10_000n * USDG);
});
