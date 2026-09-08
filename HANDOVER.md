# Handover

For the engineer taking this to mainnet. Read this before deploying anything.

The short version: **the vault contract is ready to be tested. The thing that
would drive it does not exist yet.** Nothing in this repository has ever touched
a live chain, signed a transaction, or held a key.

## What is in the box

| Component | Path | State |
|---|---|---|
| Custody contract | `contracts/ResidentVault.sol` | Complete, 30 tests on a local EVM, **unaudited** |
| Strategy math | `src/lib/sim/` | Complete and tested (122 tests), **pure functions — decides nothing on its own** |
| Chain constants | `src/lib/chain.ts` | Transcribed from official sources, **never checked against the chain** |
| Token registry | `src/lib/tokens.ts` | 194 canonical tokens, checksums verified, addresses not read on-chain |
| Read-only adapters | `src/lib/desk/` | Reads vault state over JSON-RPC. Reads only |
| Site + dashboards | `src/app/` | Runs on fixtures until a vault is configured, and says so on screen |
| Chain verifier | `scripts/verify-chain.mjs` | **Run this first.** See below |

## What does not exist

There is no keeper. Nothing in this repository:

- opens, re-centres or closes a liquidity position,
- calls `recordRealized`, `absorbLoss`, `distribute`, or `exec`,
- signs or sends any transaction,
- holds or reads a private key.

`grep -rn "recordRealized\|distribute(" src/ scripts/` returns only prose in the
docs copy. The vault is a safe with a well-tested lock and no operator. Writing
that operator — the loop that reads the opportunity board, applies
`evaluateEntry`, mints the position through the v4 position manager, tracks it,
and reports profit back to the vault — is the work between here and a running
desk. Budget for it as a real project, not a wiring exercise.

Two dependencies that operator needs and does not have:

1. **An indexer.** Pool selection needs per-pool volume windows and LP event
   history. An RPC alone cannot serve these at usable speed. `INTEGRATIONS.md`
   names the interface (`PoolsSource`, `HistorySource`); both currently have
   fixture implementations only.
2. **A reference price feed.** `RESIDENT_REFERENCE_API_URL` in `.env.example`
   is unset and there is no client for it.

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

**What it cannot check, and what stops this stage today:** there is no keeper.
Nothing in this repository opens a position, calls `recordRealized`, or signs
anything. A funded vault with nothing driving it holds money and does nothing —
so funding it now buys no information that stage 2 does not give you for free.
Testnet is chain 46630 and the same commands work there.

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
