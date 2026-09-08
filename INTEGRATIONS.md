# Integrations

Most of the chain constants are now filled in. This records where each came
from, how far it has been checked, and what is still outstanding.

## Verification status — read this first

Direct access to `docs.robinhood.com`, `developers.uniswap.org`, the Robinhood
Chain RPC and its block explorer are all blocked by this environment's egress
policy. What worked was web search and `raw.githubusercontent.com`.

So every address below was transcribed from an official source and **fetched
twice from two different URLs**, matching character-for-character both times.
That proves the transcription is faithful. It does **not** prove the address
holds the contract it is labelled with, because nothing has been checked
against the chain.

```bash
RESIDENT_USDG=0x... RESIDENT_VAULT=0x... npm run verify:chain
```

Confirms the chain id, that every address has bytecode, and that USDG answers
`symbol()` and `decimals()`. Non-zero exit on any failure, so it can gate a
deploy. **Run it before anything touches money.**

## 1. Chain access — found

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain id | `4663` | `46630` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | same |
| Gas token | ETH | ETH |

Robinhood Chain is an Arbitrum Orbit L2. The public RPC is rate-limited and not
recommended for production — QuickNode, Dwellir and ArrowRPC publish endpoints.
Set `RESIDENT_RPC_URL` to override.

**This row is the weakest link.** It comes from web search rather than the docs
site, which is blocked. Confirm the chain id first; `verify:chain` does it in
one call.

Still needed: the chain's **EVM version**. `test/harness.mjs` pins `shanghai`,
solc defaults to something newer, and a mismatch produces bytecode that reverts
with `invalid opcode` on deploy.

## 2. Contracts — found, except USDG

From `github.com/Uniswap/contracts/blob/main/deployments/4663.md`:

| Contract | Address |
| --- | --- |
| UniswapV3Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| TickLens | `0x7dfd4f31be6814d2906bde155c3e1b146eac1468` |
| UniswapInterfaceMulticall | `0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3` |
| v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| v4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| v4 PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| v4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` |

Permit2 matches its canonical cross-chain address, which is a third
independent check on that row.

From `github.com/ponsdotdev/ponsfamily`:

| Contract | Address |
| --- | --- |
| PonsV2LaunchFactory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| PonsLaunchFactory (v1) | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` |

**A correction to what I asked for last time.** There is no static Pons fee
escrow to configure. V2 keeps a claim-based `IPonsV2FeeEscrow` ledger rather
than one escrow contract, and every launch mints into its own bonding curve, so
there is no single address. What the desk needs is the factory (above) plus the
$RES launch address once it exists — set `RESIDENT_TOKEN`. The vault is named
as the launch's creator-fee recipient and the keeper claims against the ledger.

From `docs.robinhood.com/chain/contracts`:

| Token | Address |
| --- | --- |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

### The canonical token registry — complete

`src/lib/tokens.ts` holds all 194 tokens from the contracts page: **177 stock
tokens** and **17 tokenized ETFs**, kept apart because the method excludes ETFs
categorically.

Integrity, checked on every commit by `test/registry.test.mjs`:

- All 194 addresses well-formed and unique, none colliding with USDG or WETH.
- 193 carry a valid **EIP-55 checksum**; LLY is published all-lowercase, which
  is a legal unchecksummed form. Changing one hex character changes the required
  capitalisation almost every time, so this is real evidence of faithful
  transcription rather than a formatting check.
- The ETF split was derived two independent ways — an explicit ticker list and a
  name-keyword scan — which agreed on all 194 rows. Worth doing, because six of
  the seventeen carry no "ETF" in their name at all (QQQ, SGOV, GLD, SLV, USO,
  EWY).

What the checksum cannot catch is a **transposed row** — a correctly copied
address on the wrong ticker. Only the chain settles that, so `verify:chain`
reads `symbol()` back from all 194 and compares.

### Still outstanding

| Variable | What | Status |
| --- | --- | --- |
| `RESIDENT_VAULT` | Your deployed vault | Does not exist yet |
| `RESIDENT_TOKEN` | The $RES launch | Does not exist yet |

## The canonical stock-token registry

The contracts page carries a warning that matters more for this desk than for
most consumers of it:

> Use the addresses on this page to identify the **canonical** Robinhood Stock
> Token for each underlying — a token with a matching name/ticker but a
> different contract address is not a Robinhood Stock Token.

An impostor is the one thing the rest of the gate cannot catch. A fake token
with the right ticker, in a thin pool, has exactly the shallow book and violent
deviations the desk is built to hunt — it would be classified eligible, bought
with real USDG, and held as worthless inventory. The fillability probe does not
help: it proves a pool can be sold into, not that the asset is real. There is a
test asserting precisely this — without the registry, a fake AMC is a textbook
actionable dislocation.

So `classify()` and `evaluate()` now check token identity **before** any depth
measurement, and `verify:chain` fails while `STOCK_TOKENS` is empty. Populate it
from that page with every ticker the desk is allowed to hold, and nothing else.

Everything the keeper touches must also go on the vault's allowlist after
deploy — `setVenue(address,bool)`, owner only. The keeper cannot reach anything
that is not on that list.

## 3. Tracking the tokens

Two data paths, deliberately separate, because they answer different questions
and have different tolerances for being wrong.

### Discovery, history and analytics → Bitquery

Bitquery already indexes Robinhood Chain end to end — decoded events, token
transfers, DEX trades and pool liquidity — behind one GraphQL endpoint, with any
query convertible to a WebSocket stream. It also carries dedicated Pons and
pools.trade launchpad APIs. That covers everything the board and the tracker
need without building an indexer:

| What | Where it comes from |
| --- | --- |
| New pools | v4 `Initialize` on PoolManager; v3 `PoolCreated` on the factory |
| New launches | Pons v2 factory `TokenLaunched` / `PoolGraduated`; pools.trade |
| Volume windows, 24h peak | `Swap` events, bucketed |
| Pool age | first `Initialize` / `PoolCreated` block |
| LP adds and removes, by wallet | v4 `ModifyLiquidity`; v3 `Mint` / `Burn` / `Collect` |
| Realised volatility | the price series, from the same swaps |

Set `RESIDENT_INDEXER_URL` and an API key.

### Sizing and execution → direct RPC, never the index

Anything that decides an order size or goes into a transaction reads the chain
directly through `StateView`, not Bitquery. Robinhood Chain produces a block
roughly every 100ms, so even a one-second indexer lag is about ten blocks — long
enough for a fill to land at a price the index has not seen. The index says
*where to look*; the chain says *what to send*.

### Uniswap v4 is the venue that matters, and it is not v3

Roughly half of DEX volume on the chain is v4, about a third v3, and every
position on the dashboard this desk is modelled on is v4.

v4 is a singleton. There is no per-pool contract: pools live inside PoolManager
addressed by `PoolId = keccak256(abi.encode(PoolKey))`, and state is read via
`StateView`. `src/lib/sim/v4.ts` does that and returns the same `PoolState` the
swap engine, the gates and the backtest already consume, so nothing downstream
changes. The v3 reader in `pools.ts` is kept for v3 pools and cannot see v4 at
all.

Two things that bite here, both now covered by tests:

- **Currencies must be sorted.** v4 does not sort them for you, and an unsorted
  key hashes to a pool that does not exist — reads return zeros rather than an
  error. `poolId()` throws instead.
- **ABI sign-extends.** `int24` ticks and `int128` liquidityNet arrive
  sign-extended across a full 256-bit word. Decoding at the native width turns
  tick −201900 into an enormous positive number, which is every pool priced
  below 1.0 — i.e. most memecoin pairs.

Also worth knowing: the fee charged is the `lpFee` from `slot0`, not the fee in
the pool key. A hook can override it, which is the same reason the opportunity
board gates on hook-free pools.

## 4. If you would rather not depend on Bitquery

The opportunity board and the smart-LP tracker need data an RPC cannot serve
fast enough:

- **Per-pool volume** over 5m / 1h / 6h / 24h windows.
- **24h price peak** per pool.
- **Pool creation time**, for the age gate.
- **Mint / burn / collect events** with the wallet behind each, for wallet
  scoring.
- **Swap events** with in-range liquidity, to credit fees to positions.

Self-hosting is a day or two of work and removes the third-party dependency on
the one input the desk cannot run without.

The v4 singleton makes this much easier than it would have been on v3: there is
one contract to watch rather than one per pool. A Ponder or Graph node indexing
`PoolManager` (`Initialize`, `Swap`, `ModifyLiquidity`), the v3 factory, and the
Pons v2 factory covers the whole table above.

Log polling straight off the RPC also works and is what I would use to get
moving, but at 100ms blocks it is a lot of logs and it is fragile across reorgs.

Either way the seam is the same: `PoolsSource` for the board, `HistorySource`
for the backtest. Supply a fetch function and nothing else changes.

## 5. Numbers that do not agree yet

The registry in `src/lib/tokens.ts` holds 194 tokens from the contracts page,
but the chain is reported to carry 450+ stock tokens and tokenized ETFs. Either
the page was a subset, or it has moved on since. Worth reconciling before the
canonical check is relied on, since a real token missing from the registry is
refused as an impostor — the safe direction to fail, but still wrong.

## 4. Reference prices

`RESIDENT_REFERENCE_API_URL` / `RESIDENT_REFERENCE_API_KEY`.

The whole method is priced against the issuer's consolidated primary-market
quote — bid/ask midpoint × the corporate-action multiplier, refreshed every 15
seconds, with Chainlink tokenized-equity feeds as the fallback. I need to know
which issuer feed you have access to and how it authenticates. Without it the
desk has no P̂ and every gate downstream is meaningless.

If Chainlink feeds are the primary rather than the fallback, I need the feed
addresses per instrument, and the ETH/USD feed for ETH-quoted venues.

## 5. Keys, which I should not have

Deployment and the keeper both need private keys. I have not asked for any and
should not be given any. Deploy from your own machine following
`DEPLOYMENT.md`; the keeper needs its own key holding gas only, kept separate
from the owner key that can withdraw.

## What already works without any of this

- `npm test` — 68 tests: vault, selectors, swap math, desk gates, opportunity
  engine, smart-LP tracker.
- `npm run simulate -- --scenarios` — the decision gate against constructed
  pools.
- `/desk` and `/desk/pools` — both run on fixtures and say so on screen.

## What is still unverified regardless of configuration

- No contract has been deployed anywhere, and none is audited.
- The swap engine has never run against a real pool.
- `sqrtPriceAtTick` uses floating-point `Math.pow` rather than exact TickMath
  (~1e-12 relative). Fine for sizing, wrong for an on-chain port.
- The tick loader reads ±40 spacings, so a swap walking past that window
  under-reports depth.
- Fee estimates on the board assume a band sits in range for the whole window
  at a constant share. That is the optimistic case, not the expected case.
