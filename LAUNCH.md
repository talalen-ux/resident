# Launch checklist

The running order, in the order things actually happen. `GO-LIVE.md` explains
why each piece works the way it does; this is what to do.

Every step says who signs it and whether it can be undone. Nothing here is
reversible by the keeper. The keeper cannot withdraw, cannot allowlist and
cannot change where fees go — those are all yours, signed by hand, one at a
time.

**Rough timings.** Part one is an afternoon. Part two is however long you want
to watch it. Part three is launch day and takes about twenty minutes of
signing.

---

# Part one — before the token exists

Nothing here needs $RES, and nothing here is urgent. All of it can be done and
left running today.

## 1. Paper run, no money

Free, reversible, and the only step that costs nothing at all. On Railway, set:

```
RESIDENT_PAPER    = 10000
RESIDENT_RPC_URL  = https://rpc.mainnet.chain.robinhood.com
RESIDENT_JOURNAL  = /data/keeper.ndjson
```

Add the volume first: **Service → Settings → Volumes → Add Volume**, mount path
`/data`. The keeper refuses to start without one, because a journal that does
not survive a redeploy is a keeper that opens the same position twice.

Read it with:

```bash
npm run report -- --journal /data/keeper.ndjson --deposit 10000
```

The line that matters is `vs simply holding`. Principal alone shows a gain on
exactly the price move that cost you money.

## 2. Make the keeper key

```bash
npm run newkey
```

One key, one address, printed once and stored nowhere. Copy both. The key goes
into Railway at step 9. The address goes into step 3.

Use it for nothing else. Do not reuse a wallet you already hold.

## 3. Deploy the vault

```bash
npm run deploy -- <YOUR_WALLET> <KEEPER_ADDRESS>
```

`<YOUR_WALLET>` is the owner — a hardware wallet if you have one. It can
withdraw everything, so it never goes on a server.

This signs nothing. It writes `deploy.hex`, which you send from any wallet with
gas. Whoever sends it does not become the owner; the owner is set in the
constructor.

Note the deployed address. It is `RESIDENT_VAULT` everywhere below.

## 4. Allowlist three contracts

**Three signatures from the owner wallet.** Each prints calldata to paste into
your wallet.

```bash
export RESIDENT_VAULT=0xYourVault

npm run owner -- set-venue 0x000000000022D473030F116dDEE9F6B43aC78BA3 true  # Permit2
npm run owner -- set-venue 0x58daec3116aae6d93017baaea7749052e8a04fa7 true  # v4 position manager
npm run owner -- set-venue 0x8876789976decbfcbbbe364623c63652db8c0904 true  # UniversalRouter
```

All three are required, for different reasons.

A v4 mint pulls tokens through Permit2, so missing either of the first two
reverts every mint after spending the gas.

The router is needed on both legs. A range that straddles the current price is
funded with **both** tokens and the treasury holds one, so every open buys the
other side through the router before it mints — without it no position opens.
It is also how harvested fees get sold back to USDG, without which the treasury
slowly turns into a bag of the tokens it has been making markets in.

Reversible: pass `false` to undo any of them.

## 5. Preflight

```bash
npm run preflight
```

It reads the deployed vault and exits non-zero on anything wrong. **Do not
continue past a failure.** Warnings about the launch are expected here — there
is no launch yet.

## 6. Railway, no key

Swap the paper variables for the real ones:

| Variable | Value |
|---|---|
| `RESIDENT_RPC_URL` | your mainnet RPC (**with `https://`**) |
| `RESIDENT_VAULT` | step 3 |
| `RESIDENT_JOURNAL` | `/data/keeper.ndjson` |
| `RESIDENT_KEEPER_ADDRESS` | step 2 |

Leave `RESIDENT_KEEPER_KEY` out. Leave `RESIDENT_NETWORK` unset. Check
**Settings → Deploy → Replicas** is **1** — two keepers sharing a vault both
decide, both submit, and the nonce collision looks like a random revert.

With the address set and no key, every call the keeper builds goes to the node
as `eth_estimateGas`. It executes against real state and reverts exactly where
a real send would, with no key anywhere. This is the step that replaces a
testnet run, and it answers in minutes.

**Fix everything it raises before going further.**

---

# Part two — turning it on

## 7. Fund it small

Send USDG to the vault. An amount you would be relaxed about losing entirely:
a stolen keeper key cannot withdraw, but it can still lose money through bad
positions on a venue you allowlisted.

## 8. Send the keeper gas

A small amount of native token to the keeper address. It never needs anything
else — every asset stays in the vault.

## 9. Add the key and let it sign

**Railway → Variables:**

```
RESIDENT_KEEPER_KEY   = 0x...   (step 2)
RESIDENT_ALLOW_MAINNET = 1
```

Two separate gates on purpose: the key decides whether it can sign at all, the
flag decides whether it may do so here. The chain id is checked against what
the node reports on every transaction.

The startup log prints the signer address. Check it is the one in the vault.

Then watch the first position open, and the first sweep. **The contracts have
not been audited.**

---

# Part three — launch day

## 10. Launch $RES

**The vault does not care which launchpad.** It takes fees as ordinary ERC20
balance: the money lands, the keeper sees it as idle capital, and the next tick
deploys it like any other capital. No contract knows the name of a launchpad,
and none needs to. If you launch somewhere other than Pons, set the fee
recipient to the vault and skip straight to step 12.

The rest of this step is the Pons-specific case, where fees are held in escrow
until claimed rather than pushed to the recipient. Two configuration choices
matter there, and both are frozen at launch.

Two configuration choices matter, and both are frozen at launch.

**Fee recipient → the vault.** This is the whole design, and it is the one
thing that must be right on every launchpad. Set it to the vault address from
step 3. On Pons, if the launch UI will not let you set it up front, launch with
your own wallet and fix it in step 11 — that path works and has no timelock.

**Buyback-and-lock → off, if you want the keeper to sweep on its own
schedule.** With buyback enabled, part of every creator fee is earmarked for an
internal swap, and Pons's operator is the only address allowed to perform the
sweep that releases it. The fees are still yours and still arrive; you wait on
their cadence rather than yours. With it disabled the vault sweeps its own fees
every tick.

It is a real trade: buyback-and-lock is a token-side benefit you would be
giving up. Decide it deliberately rather than by default.

## 11. Point the fees at the vault

Skip if step 10 already did it. Otherwise:

```bash
npm run owner -- point-launch-fees <RES_TOKEN_ADDRESS>
```

**Signed by the wallet that currently receives the launch's fees** — the wallet
that launched. Not the owner wallet, unless they are the same. No timelock, no
waiting.

**One way.** This makes the vault the fee recipient, and the vault has no
function to hand the stream back. Check the address before you sign it.

It does two things at once, which is worth knowing: the recipient is also the
only address allowed to sweep the bonding curve, so this single call both
redirects the money and gives the keeper the right to collect it.

## 12. Tell the keeper about the launch

**Railway → Variables:**

| Variable | Value |
|---|---|
| `RESIDENT_TOKEN` | the $RES token address |
| `RESIDENT_TOKEN_BLOCK` | the block it was deployed at |
| `RESIDENT_NOT_HOLDERS` | comma-separated: the curve, the locker, anything holding $RES that is not a holder to be paid |
| `RESIDENT_LAUNCHPAD` | `pons` — **only** if you launched on Pons. Leave unset otherwise. |

`RESIDENT_TOKEN` is what the holder list is built from, and is needed wherever
you launched. `RESIDENT_LAUNCHPAD` is separate and opt-in: it turns on the
escrow-claiming path, which only Pons needs. Set it for a token launched
elsewhere and the keeper looks the launch up on a factory that never launched
it, and complains every tick about something that is fine.

On Pons, `RESIDENT_TOKEN` plus `RESIDENT_LAUNCHPAD=pons` is enough to start
collecting. The keeper reads the
launch record each tick and works out where the fees are — the bonding curve
before graduation, the hook after it. **You do not have to do anything on
graduation day.** That was deliberate: a desk whose operator has to notice a
graduation is a desk that stops collecting on the day it gets busy.

`RESIDENT_TOKEN_BLOCK` matters for a different reason. Without it, building the
holder list scans from genesis.

## 13. Preflight again

```bash
RESIDENT_TOKEN=0xRES RESIDENT_LAUNCHPAD=pons npm run preflight
```

Now the launch section has something to check. What you want to see:

```
  ✓ creator fees pay the vault (not graduated, 100 bps creator tax)
  ✓ the vault may sweep its own curve fees
```

If it says `creator fees pay 0x…, NOT the vault`, go back to step 11. Every fee
the token earns is currently going somewhere else, and nothing reverts to tell
you.

## 14. After graduation

Only once the launch has graduated into a v4 pool. Two more variables and two
more signatures:

| Variable | Value |
|---|---|
| `RESIDENT_PONS_HOOK` | the PonsV2MemeHook address |
| `RESIDENT_RES_POOL_ID` | the launch's v4 pool id (bytes32) |

```bash
npm run owner -- set-venue <PONS_HOOK> true
npm run owner -- set-venue <FEE_ESCROW> true
```

The escrow address is not configured anywhere — it is read off the hook, which
exposes it as an immutable public. Get it from `npm run preflight`, which
prints both once `RESIDENT_PONS_HOOK` is set.

## 15. The control console

Optional, and the last thing to set up. Manual override for an opportunity the
board has not priced, or a position that has become a risk for a reason no
price history contains.

| Variable | Value |
|---|---|
| `RESIDENT_CONTROL_WALLET` | the owner wallet |
| `RESIDENT_CONTROL_ORIGIN` | your site's origin |

Then set `NEXT_PUBLIC_KEEPER_URL` on the website and open `/desk/control`.
Authority is a wallet signature, not a secret — there is nothing to leak in a
screenshot, and revoking access is a wallet change.

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
broadcast is still pending. Check the last journal line's hash on the explorer
and restart it; the next tick reconciles against the receipt.

## What is still missing

- **An audit.** The vault holds fees under a keeper's instruction and can bridge.
- **Solana.** The executor is Robinhood Chain only. Meteora needs its own.
