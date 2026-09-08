# Deploying ResidentVault

Everything here runs on your machine, with your keys. Nothing in this repo has
touched a live chain.

## What has actually been verified

`contracts/ResidentVault.sol` compiles under solc 0.8.28 and passes 30 tests on
a real EVM (`npm run test:contracts`), one per property the site claims. That is
unit-level assurance against a local VM. It is **not**:

- an audit,
- a test against real venue contracts, real tokens, or real liquidity,
- any evidence about behaviour under adversarial mainnet conditions (reorgs,
  MEV, sandwiching, malicious tokens, fee-on-transfer tokens, reentrant venues).

## Why this session could not fork-test

Two hard blocks in the environment this was built in:

1. **Every chain RPC is refused by the egress policy** — `eth.llamarpc.com`
   returns 403 at the proxy. With no RPC there is no forked state to test
   against.
2. **Hardhat and Foundry both download a compiler at first run**, from
   `binaries.soliditylang.org` and GitHub respectively. Both hosts are blocked.
   The suite therefore compiles with the npm `solc` package and executes against
   `@ethereumjs/vm` (`test/harness.mjs`). Real EVM semantics, no network.

Fork tests are the next thing to run, and they need to run somewhere with
network access.

## Before any mainnet deployment

The vault custodies inventory and owes money to holders. Deploying it to a live
chain to "see if it works" means finding out with other people's funds. In
order:

1. **Pin `evmVersion` to the target chain.** `test/harness.mjs` sets `shanghai`.
   solc's default is newer than some chains support, and a mismatch produces
   bytecode that reverts with `invalid opcode` on deploy — which is exactly how
   it failed here before it was pinned. Confirm what Robinhood Chain supports.
2. **Fork-test against real venues.** Point Anvil or Hardhat at an archive RPC
   and exercise `exec` against the actual Uniswap v3/v4 routers, with real
   tokens, at a real block.
3. **Test the token surface you will actually hold.** The suite uses a
   well-behaved ERC20. Tokenized equities may rebase on corporate actions, may
   charge fees on transfer, and may pause. Each of those changes the accounting.
4. **Get an audit.** Specifically of the profit ledger and the distribution
   envelope, which are what stand between a keeper bug and holder funds.
5. **Deploy to a testnet and run the keeper against it** for long enough to see
   a full distribution cycle, a rate-limit refusal, and a keeper rotation.
6. **Deploy with a cap you are willing to lose,** and raise it only after the
   desk has run.

## Fork test

```bash
# with an archive RPC you control
anvil --fork-url "$RPC_URL" --fork-block-number <block>

# in another shell, against the fork at http://127.0.0.1:8545
forge test --fork-url http://127.0.0.1:8545 -vvv
```

The suite in `test/` is written against the local harness rather than Foundry.
Port it, or drive the fork through the same harness by swapping the ethereumjs
state manager for an RPC-backed one.

## Deploy

Constructor takes `(owner, keeper, payoutAsset)`.

```bash
forge create contracts/ResidentVault.sol:ResidentVault \
  --rpc-url "$RPC_URL" \
  --constructor-args "$OWNER" "$KEEPER" "$USDG" \
  --verify
```

Then, as owner:

```bash
# allowlist each venue the keeper may call and approve
cast send "$VAULT" "setVenue(address,bool)" "$ROUTER" true --rpc-url "$RPC_URL"

# set the rolling per-window distribution cap, in payout-asset minor units
cast send "$VAULT" "setCap(address,uint128)" "$USDG" 1000000000000 --rpc-url "$RPC_URL"
```

`setCap` is not optional. It defaults to zero, which blocks every distribution
until it is set — deliberately, so a fresh vault cannot pay out before the
operator has chosen a limit.

## Point the dashboard at it

```bash
NEXT_PUBLIC_RPC_URL=https://...
NEXT_PUBLIC_VAULT_ADDRESS=0x...
NEXT_PUBLIC_CHAIN_NAME="Robinhood Chain"
```

With those set, `/desk` switches from fixtures to the live vault and the
"fixture data" chip becomes the chain name. The ledger, roles and rate limit
come off the contract. Positions, dislocations, distributions and the eligible
set are the keeper's working state rather than contract state, so they stay
empty until the keeper serves them.

## The owner key

`withdraw` has no timelock and no cap. Whoever holds the owner key can empty the
vault at any moment. That is a deliberate design choice, disclosed on the site
and at the function, and it means the operational security of that one key is
the counterparty risk of the whole desk. Use a hardware wallet or a multisig,
and make the owner a different key from the keeper — the contract keeps them
separate for a reason.
