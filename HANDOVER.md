# Handover

For the engineer taking this to mainnet. Read this before deploying anything.

The short version: **the vault contract is ready to be tested, and the process
that would drive it now exists and signs nothing.** It reads chains, ranks
pools, decides, and writes down what it would have done. Two pieces stand
between that and a running desk, and both are named below. Nothing in this
repository has ever touched a live chain, signed a transaction, or held a key.

## What is in the box

| Component | Path | State |
|---|---|---|
| Custody contract | `contracts/ResidentVault.sol` | Complete, 40 tests on a local EVM, **unaudited** |
| Strategy math | `src/lib/sim/` | Complete and tested (309 tests), **pure functions — decides nothing on its own** |
| Chain constants | `src/lib/chain.ts` | Transcribed from official sources, **never checked against the chain** |
| Token registry | `src/lib/tokens.ts` | 194 canonical tokens, checksums verified, addresses not read on-chain |
| Keeper | `src/lib/keeper/` | Journal, reconciliation, sweep and retire rules, decision ordering, tick loop, ledger, **Robinhood Chain v4 executor**. **Dry run only: no signer** |
| Read-only adapters | `src/lib/desk/` | Reads vault state over JSON-RPC. Reads only |
| Site + dashboards | `src/app/` | Runs on fixtures until a vault is configured, and says so on screen |
| Chain verifier | `scripts/verify-chain.mjs` | **Run this first.** See below |

## What the keeper does, and what it cannot do

`npm run keeper` runs it. It needs `RESIDENT_RPC_URL` and nothing else, because
it takes volume, pool age and price history out of Swap and Initialize logs
rather than from an indexer.

Each interval it reconciles anything left in flight, prices every watched pool,
marks every open position, decides, and journals. The decision order is fixed
and is the part worth reading before changing anything: retire what has stopped
earning, sweep what is worth sweeping, re-centre what has drifted, deploy idle
capital, then consider crossing a chain. See `src/lib/keeper/decide.ts`.

**It signs nothing, and there is no flag in this repository that changes that.**

Robinhood Chain execution is built. `executor-v4.ts` turns an intent into
calldata for the v4 position manager, always through `vault.exec` and never
directly at a venue:

| Intent | v4 actions | Note |
|---|---|---|
| open | `MINT_POSITION`, `SETTLE_PAIR` | band centred on the price read at submission, not the price the tick was decided from |
| sweep | `DECREASE_LIQUIDITY` (zero), `TAKE_PAIR` | v4 has no collect action; a decrease of nothing is how it is spelled |
| close | `BURN_POSITION`, `TAKE_PAIR` | burn decreases to zero first, so it is one action |
| rebalance | `BURN_POSITION`, `MINT_POSITION`, `CLOSE_CURRENCY` ×2 | **one unlock.** Two transactions can half-succeed and leave the desk holding inventory with no position |

Action codes and parameter tuples are transcribed from @uniswap/v4-periphery
1.0.3 and checked by decoding the calldata back in the tests, because a wrong
code does not fail loudly — it performs a different action.

**Before a mint can settle, allowlist two addresses, not one.** The position
manager pulls tokens through Permit2, so the vault needs to call Permit2 (to
grant it an allowance) and the position manager (to mint). `npm run preflight`
checks both and fails if either is missing.

What is still absent:

1. **A signer, if you want one.** There are now two, and neither needs a KMS.

   Without `RESIDENT_KEEPER_KEY` the loop builds every call and signs none of
   them. That is the mode to leave running for a week first.

   With one, `signer-local.ts` signs with a key held in the process. That is a
   real trade and the note at the top of that file states it plainly: anyone who
   can read the environment can take the key. What makes it survivable is the
   vault. A stolen keeper key cannot withdraw, cannot add a venue or a bridge,
   cannot raise a cap, and can be rotated away in one transaction that moves no
   assets. It can still LOSE money through `exec` on an allowlisted venue, so
   size the vault to what you would accept losing to a compromised container.

   Guardrails, all tested: a malformed key is refused without the value
   appearing in the error, mainnet is refused unless `RESIDENT_ALLOW_MAINNET=1`,
   and the chain id is read from the node on every transaction rather than once
   at startup, because an RPC URL is an environment variable and a keeper that
   follows its RPC onto mainnet is the thing being prevented. `checkSigner`
   refuses to run as the vault owner and refuses a signer that is not the
   vault's keeper, re-checked every interval.

   `tx.ts` still takes an arbitrary `sign` function, so moving this to a KMS
   later changes nothing else about the deployment.
2. **Solana.** `executor-v4.ts` is Robinhood Chain only. Meteora needs its own,
   to the same contract: if a call is broadcast and its outcome cannot be
   established, raise `Unconfirmed` rather than throwing. An ordinary error is
   recorded as a failure and stepped past; `Unconfirmed` leaves the intent in
   flight so the next interval has to go and look. Getting that backwards is
   how the same position gets opened twice.

## The owner is a wallet you hold

The owner can withdraw every asset the vault holds, so it is the one role that
must never be a key on a server. It is not one here: `npm run owner` prints the
destination, value and calldata for every owner action and signs nothing.

```bash
npm run owner -- rotate-keeper 0xNEW
npm run owner -- set-venue 0xPERMIT2 true
npm run owner -- withdraw 0xUSDG 0xYOU 1000000000
```

Paste the result into a hardware wallet, a Safe, or the explorer's write tab.
Run it with no arguments to list every action and what each one cannot be
undone by.

So the split is: **owner** is your wallet, capped by nothing, signing rarely and
deliberately; **keeper** is a hot key in a container, capped by the contract,
signing constantly. Two addresses, and the vault enforces that they are two.

Reconciliation is a receipt lookup rather than a search: the broadcast hash is
journalled at the moment the outcome becomes unknown, so the next tick fetches
one receipt and knows. A transaction still pending stops the keeper rather than
being decided either way.

Leave the dry run pointed at a live RPC for a week before either exists. The
journal it produces says which positions the desk would have opened and when it
would have moved them, and those can be checked against what the pools actually
paid — for nothing, and before any money is at risk.

Still missing, and neither blocks the dry run:

1. **Volatility for Meteora pairs.** The scanner refuses to price a pool without
   it rather than treating it as calm, so Solana pools are skipped and reported
   until a source exists.
2. **Husher's real numbers.** `BridgeCost` takes a fee, a fixed cost and a
   latency. The allocation figures are only as good as those three.

## Cross-chain allocation (Solana / Meteora)

The decision layer is built and tested: `src/lib/sim/dlmm.ts` prices a Meteora
DLMM position, `src/lib/sim/allocate.ts` decides whether moving capital is worth
the round trip. Neither can move anything — there is no bridge implementation
and no Solana signer.

Two things to know before wiring one up.

**DLMM is not v3 with different names.** Only the *active bin* earns fees, so
spreading capital over sixty bins divides the earning stake by sixty rather than
widening an earning range. A model carried over from v3 overstates a wide DLMM
position badly. `evaluateDlmm` prices this correctly and returns the same units
as `evaluateEntry`, which is what lets the two chains be compared at all.

**Bridging changes the security model categorically.** Every guarantee the vault
makes is an EVM guarantee — the venue allowlist, spender-gated approvals, the
distribution rate limit. None of it reaches across a bridge. A keeper that can
bridge can send funds to a chain where the contract has no authority at all.

The contract now bounds that by policy rather than by trust. `bridgeOut` is a
separate entry point from `exec` — deliberately, so the cap cannot be bypassed
by encoding a bridge call as a venue call — and it enforces a per-destination
rolling cap, kept apart from the distribution limit so bridging can never eat
the holders' payout window.

Opening a route is **two owner transactions, and the order matters**:

```solidity
vault.setBridge(bridgeAddress, true);          // allow it
vault.setBridgeCap(bridgeAddress, 50_000e6);   // and only then, fund the cap
```

The cap defaults to zero, so an allowlisted bridge with no cap moves nothing.
That is the mechanism, not an oversight: a single mis-click cannot open a route.
Set the cap to what you would accept losing in a window, not to what the vault
holds. `bridgeLimitRemaining(bridge)` reads the headroom.

Ten tests cover the envelope under sequences a compromised keeper would try —
splitting a transfer to get past the cap, spending one bridge's allowance
through another, and using a revoked bridge.

The allocator takes a bridge's fee, fixed cost and latency as plain numbers
(`BridgeCost`), so whatever moves the funds — existing perp infrastructure, a
bridge's quote endpoint, a published rate — feeds it directly. What it must
never be given is a guess: costs that are made up make every crossing look
profitable, which is the one failure mode this model exists to prevent.

## Going live, in the order that is actually safe

Three stages. Each is genuinely useful on its own, and the risk only appears at
the third.

**1. The site — today, no risk.** It is a static Next.js app. `vercel.json`
pins the framework; set `NEXT_PUBLIC_SITE_URL` to the real domain or every
share card points at the wrong host, and `NEXT_PUBLIC_TOKEN_URL` when the pool
exists (until then every call to action reads "Launching soon").

**2. Monitoring — today, still no funds and no keys.** Everything that reads
the chain works with an RPC alone:

```bash
RESIDENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com npm run verify:chain
RESIDENT_RPC_URL=... npm run pools     # discover, observe, rank
```

Run `verify:chain` first regardless. Every address in `src/lib/chain.ts` was
transcribed from published sources and has never been checked against the chain,
because the environment this was written in cannot reach it. That is the single
weakest assumption in the repository and it costs one command to settle.

This stage is worth sitting in for a while. It is where you find out whether the
board picks the pools you would have picked, at no cost.

**3. Funds.** Before this, run:

```bash
RESIDENT_RPC_URL=... RESIDENT_VAULT=0x... npm run preflight
```

It reads only — no key, no signature, nothing changed — and exits non-zero if
anything fails, so it can gate a funding transaction rather than relying on
someone reading the output. It checks the deployed bytecode answers this
source's ABI, that owner and keeper are different addresses, that the split is
15%, that the ledger is zeroed, that the distribution cap is set, and that any
allowlisted bridge has a cap you meant.

**What it cannot check, and what stops this stage today:** the keeper builds
every call and signs none of them, so nothing opens a position or calls
`recordRealized`. A funded
vault with nothing driving it holds money and does nothing — so funding it now
buys no information that stage 2 does not give you for free. Testnet is chain
46630 and the same commands work there.

## Order of operations

Do not reorder these. Each one can invalidate the next.

**1. Verify the chain constants.**

```bash
RESIDENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
  node --experimental-strip-types scripts/verify-chain.mjs
```

Every address in `src/lib/chain.ts` was transcribed from published sources and
fetched twice to rule out transcription error. That proves the characters are
right. It does **not** prove the address holds the contract it is labelled with,
because the environment this was built in blocks the Robinhood Chain RPC. This
script checks the chain id, confirms every address has bytecode, and reads
USDG's symbol and decimals back. If it disagrees with the file, trust the chain.

**2. Pin `evmVersion` to what the chain supports.**

`test/harness.mjs` sets `shanghai`. solc's default is newer than some chains
accept, and a mismatch produces bytecode that reverts with `invalid opcode` on
deploy — that is exactly how it failed here before it was pinned. Confirm what
Robinhood Chain supports before compiling for deployment.

**3. Fork-test against real venues.** Neither Hardhat nor Foundry could run
here (both fetch a compiler from a blocked host), so the suite compiles with the
npm `solc` package and executes on `@ethereumjs/vm`. Real EVM semantics, no
network. Point Anvil at an archive RPC and exercise `exec` against the actual
Uniswap v3/v4 routers, with real tokens, at a real block.

**4. Test the tokens you will actually hold.** The suite uses a well-behaved
ERC20. Tokenized equities may rebase on corporate actions, may charge fees on
transfer, and may pause. Each of those changes the accounting, and the vault's
ledger assumes none of them.

**5. Testnet, with the keeper, for a full cycle.** Chain 46630. Run until you
have seen a distribution, a rate-limit refusal, and a keeper rotation.

**6. Audit** — specifically the profit ledger and the distribution envelope.
Those are what stand between a keeper bug and holder funds.

**7. Mainnet with a cap you are willing to lose.** Raise it only after the desk
has run.

## Custody, before anyone funds this

`withdraw()` lets the vault owner move any asset out at any time. No timelock,
no governance, no delay. The keeper cannot — it is restricted to allowlisted
venues and to distributions — but the owner key is a single point of total
loss. This is deliberate and documented at `/docs`, not an oversight. Decide who
holds that key, and on what hardware, before the vault holds anything.

The keeper key is separate and rotatable in one transaction (`rotateKeeper`),
so treat the keeper as compromisable and the owner as not.

## What the tests do and do not cover

`npm test` runs 30 contract tests and 122 simulation tests.

Covered: the ledger identity under every ordering of report/absorb/distribute,
the 15/85 split, monotonicity, the rate limiter across window boundaries, the
venue allowlist and the forbidden-selector list, the exact Uniswap v3 swap math
against closed-form results, tick crossing, v4 pool id derivation and sign
extension, and the ABI selectors (7 of 8 were hand-written wrong once — hence
`test/selectors.test.mjs`).

Not covered: anything adversarial, anything with a real counterparty, reorgs,
MEV, sandwiching, malicious or fee-on-transfer tokens, reentrant venues, gas
under load. A local EVM cannot produce any of it.

## Numbers on the site are ceilings, not results

Every fee projection runs at capture efficiency 1 — the naive
`volume × fee × share`, which credits a position with every fee paid at every
price it covers. Measured against a route-level simulation the realised figure
came in far below that. `captureEfficiency` in `src/lib/sim/backtest.ts` is the
knob; set it from your own fills once you have them. Until then, read every
projected number as an upper bound.

## Running it

```bash
npm install
npm test          # 30 contract + 122 sim
npm run dev       # site on :3000, dashboards on fixtures
npm run backtest  # constructed scenarios through the band policy
npm run simulate  # the gates against a simulated pool
```

`DEPLOYMENT.md` has the fork-test commands. `INTEGRATIONS.md` has the
integration interfaces and what each one still needs.
