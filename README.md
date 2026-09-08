# Resident

A liquidity protocol for tokenized equities on Robinhood Chain.

Resident deploys capital as concentrated liquidity in thin, high-turnover
tokenized equity pools. Trading fees on the `$RES` token capitalize the
positions. 15% of realized profit is distributed to holders every 15 minutes;
the remaining 85% is retained as working capital.

**Nothing here has been deployed.** The contracts carry a test suite and have
not been audited, no vault exists on mainnet, and the positions dashboard runs
on illustrative figures until one does.

## What is in here

```
contracts/      ResidentVault — custody, the profit ledger, distributions
src/lib/sim/    the strategy: pool selection, band width, entry, exits
src/lib/desk/   the adapter the dashboards read through
src/app/        the site: /, /docs, /positions, and the operator views at /desk
test/           122 tests, run on a local EVM and against the sim math
scripts/        backtest, simulate, verify-chain, artifact
```

## The strategy, briefly

A concentrated position earns fees only while price trades inside its range.
Narrower means a larger share of flow and more time out of range. The protocol's
job is choosing pools where both thin depth and real volume hold, sizing the
band against the pool's own volatility, and opening only when expected fee
income beats expected divergence loss — not when the headline fee number is
large.

Every operating threshold is documented at `/docs` and quoted from the code it
describes: `DEFAULT_ALERT_CONFIG` and `DEFAULT_WIDTH_CONFIG` /
`DEFAULT_ENTRY_CONFIG` / `DEFAULT_EXIT_CONFIG` in `src/lib/sim/`, and
`HOLDER_BPS` in `contracts/ResidentVault.sol`.

## Running it

```bash
npm install
npm run dev        # the site at http://localhost:3000
npm test           # contract tests and the sim suite
npm run lint
npm run backtest   # constructed scenarios through the band policy
npm run simulate   # the desk's gates against a simulated pool
```

The dashboards run on fixtures until a vault is configured, and say so on every
screen. To point them at a real deployment, set `NEXT_PUBLIC_RPC_URL` and
`NEXT_PUBLIC_VAULT_ADDRESS` — see `.env.example`.

## Before this touches money

- `npm run verify:chain` from a machine with RPC access. The chain constants in
  `src/lib/chain.ts` were transcribed from official sources and have never been
  checked against the chain itself.
- An audit. The contracts are tested, not reviewed.
- The indexer named in `INTEGRATIONS.md`. Pool selection needs per-pool volume
  windows and LP event history, which an RPC alone cannot serve fast enough.

## Custody

The vault owner — the deployer wallet — can withdraw any asset at any time, with
no timelock and no governance process. The keeper cannot: it is restricted to
allowlisted venues and to distributions. This is the protocol's principal risk,
it is not mitigated by the contract, and it means Resident is not non-custodial
and should not be described as such.

See `DEPLOYMENT.md` for the deployment and fork-test procedure, and
`INTEGRATIONS.md` for what is still missing.
