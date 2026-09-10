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
has never been read from the chain. It needs no key and no vault, and changes
nothing.

**This now runs by itself on Railway.** The container's start command verifies
the chain and only then starts the keeper, so the first deploy prints the whole
check into the deploy log. It fails closed: if verification fails the keeper
does not start, which is the behaviour you want from something that is about to
open positions. Railway retries on failure, so a transient RPC blip recovers on
its own while a wrong address keeps failing.

To run it by hand from anywhere that can reach the RPC:

```bash
npm ci
RESIDENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com npm run verify:chain
```

If anything fails here, stop. Everything below is built on those addresses.

### Verify against mainnet, not testnet

`chain.ts` holds **one** set of Uniswap and token addresses, taken from
Robinhood's docs, and they are mainnet addresses. Only the name, chain id, RPC
and explorer differ between the two networks. So `RESIDENT_NETWORK=testnet`
checks mainnet contracts against a chain that does not have them: every row
comes back NO CODE, and none of those failures mean anything. The verifier now
says so rather than letting you read a wall of red.

Reading mainnet is free and needs no key, and it is the only place the pools
the desk actually trades exist. Testnet would tell you nothing about turnover,
volatility or fee capture, because none of it is real there.

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

**The keeper now refuses to start without one.** At startup it checks whether
`/data` is a mounted filesystem or just a directory inside the image, and exits
naming the difference. Forgetting the volume used to be a silent mistake that
only showed up as a duplicated position weeks later; it is now a failed deploy
with a message. The startup log prints `volume /data (durable)` when it is
right.

(The Dockerfile has no `VOLUME` directive: Railway rejects any Dockerfile that
contains one. It would not have helped anyway — it declared an anonymous volume
the platform was free to ignore.)

### Add the variables

**Service → Variables → New Variable**, one at a time. Raw editor works too.

| Variable | Value |
|---|---|
| `RESIDENT_RPC_URL` | your Robinhood Chain mainnet RPC |
| `RESIDENT_VAULT` | the address from step 3 |
| `RESIDENT_JOURNAL` | `/data/keeper.ndjson` |
| `RESIDENT_KEEPER_ADDRESS` | the keeper address from step 2 |
| `RESIDENT_KEEPER_KEY` | **leave this out for now** |

Leave `RESIDENT_NETWORK` unset. Mainnet is the default, and it is where the
pools are.

### The three modes, in the order to use them

The keeper decides what it is allowed to do from those last two variables
alone, so moving between modes is a variable change and a redeploy.

| Set | What happens |
|---|---|
| neither | every call is built and journalled, nothing is sent, nothing is checked |
| `RESIDENT_KEEPER_ADDRESS` | every call is also put to the node as `eth_estimateGas`, so a mint that would revert says so — with **no key anywhere** |
| `RESIDENT_KEEPER_KEY` | it signs. Mainnet additionally needs `RESIDENT_ALLOW_MAINNET=1`, checked on every transaction against the chain id the node reports |

The middle mode is the one that replaces a testnet run. `eth_estimateGas`
executes the whole call against current state and reverts exactly where a real
send would, against the real pool, the real allowlist and the real balances.
A testnet cannot offer that, because none of those things are real there.

Do not move to the third until the second is clean.

### Check the replica count

**Service → Settings → Deploy → Replicas** must be **1**. Two keepers sharing a
vault both decide, both submit, and the nonce collision looks like a random
revert.

## 7. Run it with no key

With `RESIDENT_KEEPER_KEY` unset, the keeper reads the chain, ranks pools,
builds every transaction it would send, and signs none of them. The logs show
what it would have done; `/data/keeper.ndjson` is the record.

Two things are being checked here and they are not the same thing.

**Does the encoding survive the EVM?** With `RESIDENT_KEEPER_ADDRESS` set, every
call goes to the node as `eth_estimateGas` and reverts wherever a real send
would. A missing venue on the allowlist, a Permit2 approval that was never made,
a balance the plan overran: all of them surface here, against the real
contracts, for the price of an RPC round trip and no key. Answered in minutes,
not days. Fix anything it raises before going further.

**Is the model right?** That takes a week, and no simulation shortens it. Leave
it running, read the journal, and check what those pools actually paid against
what the board said they would. Fee capture in particular is a measurement, not
a setting, and until there are samples the scanner prices entries at an assumed
0.5 rather than at anything observed.

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

## 10. Let it sign on mainnet

Everything above reads mainnet and sends nothing. Signing there needs one more
variable, `RESIDENT_ALLOW_MAINNET=1`. Without it the signer refuses chain 4663,
checked against the chain id the node reports on **every** transaction, because
an RPC URL is an environment variable and a keeper that follows its RPC onto
mainnet is the failure that guard exists to prevent.

Two gates, deliberately separate: `RESIDENT_KEEPER_KEY` decides whether it can
sign at all, `RESIDENT_ALLOW_MAINNET` decides whether it may do so here. Reading
mainnet was never gated, because reading costs nothing and is where the real
pools are.

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
