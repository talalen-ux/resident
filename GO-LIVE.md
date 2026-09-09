# Going live on Robinhood Chain

Read this once before starting. Every step assumes the one before it.

There are two addresses in this system and keeping them apart is the whole
design:

| | Owner | Keeper |
|---|---|---|
| What it is | a wallet you hold | a key in a container |
| Can withdraw | **yes, everything** | no |
| Can add a venue or raise a cap | yes | no |
| Signs | rarely, by hand | constantly, unattended |
| If it leaks | the vault is gone | rotate it; the vault is not |

The keeper key goes on Railway. **The owner never does.**

---

## 1. Check the chain constants

Every address in `src/lib/chain.ts` was transcribed from Robinhood's docs and
has never been read from the chain. Do this from a machine that can reach the
RPC — it needs no key and changes nothing.

```bash
npm ci
RESIDENT_NETWORK=testnet npm run verify:chain
```

If anything fails here, stop. Everything below is built on those addresses.

## 2. Make a keeper key

```bash
npm run newkey
```

It prints one key and one address, once, and stores nothing.

- **Copy the private key somewhere safe for the next ten minutes.** It goes into
  Railway in step 6.
- **Write down the address.** It goes into step 3.

Use this key for nothing else. Do not use a key from a wallet you already hold.

## 3. Deploy the vault

```bash
npm run deploy -- <YOUR_WALLET> <KEEPER_ADDRESS> 
```

`<YOUR_WALLET>` is the owner: MetaMask, a Ledger, whatever you actually
control. `<KEEPER_ADDRESS>` is from step 2. The payout asset defaults to USDG.

It refuses if the two are the same address, and it signs nothing — it writes the
deployment transaction to `deploy.hex`. Send that from any wallet with gas:
whoever signs it does **not** become the owner, because the owner is set in the
constructor.

Note the deployed address. That is `RESIDENT_VAULT` from here on.

## 4. Allowlist the two Uniswap contracts

A v4 mint pulls tokens through Permit2, so the vault has to be able to call
**both** Permit2 and the position manager. Miss either and every mint reverts
after the gas is spent.

```bash
export RESIDENT_VAULT=0xYourVault
export RESIDENT_NETWORK=testnet

npm run owner -- set-venue 0x000000000022D473030F116dDEE9F6B43aC78BA3 true
npm run owner -- set-venue 0x58daec3116aae6d93017baaea7749052e8a04fa7 true
```

Each prints calldata. Sign both **from the owner wallet**.

## 5. Preflight

```bash
npm run preflight
```

It reads the deployed vault and exits non-zero if anything is wrong: bytecode
present, owner and keeper different, the 15% split, a zeroed ledger, the payout
asset, distribution and bridge caps, and both Uniswap venues allowlisted.

Do not continue past a failure.

## 6. Railway

### Create the service

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. Railway reads `railway.json` and builds the `Dockerfile`. That image runs the
   keeper, not the website.

### Add the volume — do this before the first deploy

**Service → Settings → Volumes → Add Volume**, mount path `/data`.

The journal is the record of what the desk owns. Without a volume every
redeploy loses it, and the keeper restarts believing it holds nothing. That is
how the same position gets opened twice.

### Add the variables

**Service → Variables → New Variable**, one at a time. Raw editor works too.

| Variable | Value |
|---|---|
| `RESIDENT_RPC_URL` | your Robinhood Chain RPC |
| `RESIDENT_NETWORK` | `testnet` |
| `RESIDENT_VAULT` | the address from step 3 |
| `RESIDENT_JOURNAL` | `/data/keeper.ndjson` |
| `RESIDENT_KEEPER_KEY` | **leave this out for now** |

### Check the replica count

**Service → Settings → Deploy → Replicas** must be **1**. Two keepers sharing a
vault both decide, both submit, and the nonce collision looks like a random
revert.

## 7. Run it for a week with no key

With `RESIDENT_KEEPER_KEY` unset, the keeper reads the chain, ranks pools,
builds every transaction it would send, and signs none of them. The logs show
what it would have done; `/data/keeper.ndjson` is the record.

This is the only way to find out the encoding is wrong without paying for the
discovery. Leave it. Read the journal. Check what those pools actually paid
against what the board said they would.

## 8. Add the key

**Railway → Variables → New Variable**

```
RESIDENT_KEEPER_KEY = 0x...   (from step 2)
```

Railway redeploys on save. The startup log will print:

```
  signer    local key 0xYourKeeperAddress
  keeper    0xYourKeeperAddress
```

Check that address is the one in the vault. The loop checks it too, against the
chain, every tick — it refuses to run if the signer is the vault owner or is not
the registered keeper.

Send that address a small amount of gas. It never needs anything else; every
asset stays in the vault.

## 9. Fund the vault, small

Send USDG to the vault address. Start with an amount you would be relaxed about
losing entirely, because a stolen keeper key cannot withdraw but can still lose
money through bad positions on an allowlisted venue.

Watch the first position open. Watch the first sweep. Then decide about size.

## 10. Mainnet

Everything above, with `RESIDENT_NETWORK` unset and
`RESIDENT_ALLOW_MAINNET=1`. Without that variable the signer refuses chain 4663,
checked against the chain id the node reports on **every** transaction, because
an RPC URL is an environment variable and a keeper that follows its RPC onto
mainnet is the failure that guard exists to prevent.

Before you do: the contracts have not been audited.

---

## If something goes wrong

**Rotate the keeper.** One transaction, no assets move:

```bash
npm run owner -- rotate-keeper 0xNEW
```

**Take everything out.** Owner only:

```bash
npm run owner -- withdraw 0xUSDG 0xYOU <amount>
```

**The keeper stopped.** It halts rather than guessing when a transaction it
broadcast is still pending. Look at the last line of the journal, check that
hash on the explorer, and restart it — the next tick reconciles against the
receipt.

## What is still missing

- **An audit.** The vault holds fees under a keeper's instruction and can bridge.
- **Solana.** `executor-v4.ts` is Robinhood Chain only. Meteora needs its own.
