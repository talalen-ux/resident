/**
 * Is this configuration coherent before the first tick?
 *
 * Every check here describes a container that starts cleanly and then does
 * something other than what the operator meant. A keeper holding a key with no
 * vault to act on; a key that will refuse every transaction it is asked to
 * sign; an address that is silently ignored because a key outranks it. None of
 * those announce themselves — they look like a desk that simply never trades.
 *
 * So they are refused at startup, where the message is next to the variable
 * that caused them, rather than discovered an hour later in a journal full of
 * failed intents.
 */

export type ConfigInput = {
  vault?: string;
  key?: string;
  keeperAddress?: string;
  rpcUrl?: string;
  allowMainnet: boolean;
  /** Chain id the node reports, when it has been read. */
  chainId?: number;
  mainnetChainId: number;
  controlWallet?: string;
  ponsHook?: string;
  ponsPoolId?: string;
};

export type ConfigVerdict = {
  ok: boolean;
  /** Refusals. The keeper must not start with any of these outstanding. */
  problems: string[];
  /** Things worth saying that are not refusals. */
  notes: string[];
  /** How the keeper will behave, in one word. */
  mode: "journal" | "simulate" | "sign";
};

export function checkConfig(input: ConfigInput): ConfigVerdict {
  const problems: string[] = [];
  const notes: string[] = [];

  const mode: ConfigVerdict["mode"] = input.key
    ? "sign"
    : input.keeperAddress
      ? "simulate"
      : "journal";

  if (!input.rpcUrl) {
    problems.push(
      "RESIDENT_RPC_URL is not set. The keeper reads volume, pool age and " +
        "price history from logs, and there is nothing useful it can do " +
        "without a node.",
    );
  }

  // A key with nothing to act on. The keeper would start, rank pools, and be
  // unable to build a single call, which reads as a desk that found no
  // opportunities rather than one that was never given a vault.
  if (input.key && !input.vault) {
    problems.push(
      "RESIDENT_KEEPER_KEY is set but RESIDENT_VAULT is not. A signing keeper " +
        "with no vault cannot build a single call: it would run, rank pools, " +
        "and do nothing, which looks like a quiet market rather than a " +
        "misconfiguration. Deploy the vault first (GO-LIVE step 3), or remove " +
        "the key until it exists.",
    );
  }

  // A key that will be refused on every transaction. guardChain checks this per
  // transaction on purpose, because an RPC URL can be repointed under a running
  // process — but discovering it there means an hour of failed intents.
  if (input.key && input.chainId === input.mainnetChainId && !input.allowMainnet) {
    problems.push(
      `RESIDENT_KEEPER_KEY is set and the node reports chain ` +
        `${input.chainId}, which is mainnet, but RESIDENT_ALLOW_MAINNET is not ` +
        "set. The signer refuses mainnet without it, so every transaction " +
        "would fail. Set RESIDENT_ALLOW_MAINNET=1 to say that is intended, or " +
        "remove the key and run with RESIDENT_KEEPER_ADDRESS instead, which " +
        "proves the calls against the chain without signing them.",
    );
  }

  if (input.key && input.keeperAddress) {
    notes.push(
      "RESIDENT_KEEPER_ADDRESS is ignored while RESIDENT_KEEPER_KEY is set: " +
        "the key provides the address. Remove the key to go back to simulating.",
    );
  }

  if (mode === "sign" && !problems.length) {
    notes.push(
      "This keeper will sign. Confirm the address below is the vault's keeper " +
        "and is NOT its owner; the loop checks both against the chain every tick.",
    );
  }

  if (mode === "journal" && input.vault) {
    notes.push(
      "No key and no address: every call is built and journalled, none is " +
        "sent, and none is checked against the chain. Set " +
        "RESIDENT_KEEPER_ADDRESS to have each one put to the node as " +
        "eth_estimateGas, which costs nothing and catches a mint that would " +
        "revert.",
    );
  }

  // Half a launch is worse than none: the keeper would read one of the two and
  // silently never claim.
  if (Boolean(input.ponsHook) !== Boolean(input.ponsPoolId)) {
    problems.push(
      "RESIDENT_PONS_HOOK and RESIDENT_RES_POOL_ID must be set together. With " +
        "only one the keeper cannot find the launch's fees and would never " +
        "claim them, without ever saying so.",
    );
  }

  if (!input.controlWallet) {
    notes.push(
      "RESIDENT_CONTROL_WALLET is not set, so the control console is off and " +
        "there is no way to close a position by hand.",
    );
  }

  return { ok: problems.length === 0, problems, notes, mode };
}

/** The refusal, written so the fix is in the message rather than in a doc. */
export function configFailure(verdict: ConfigVerdict): string {
  return (
    "The keeper will not start with this configuration.\n\n" +
    verdict.problems.map((problem) => `  - ${problem}`).join("\n\n") +
    "\n"
  );
}
