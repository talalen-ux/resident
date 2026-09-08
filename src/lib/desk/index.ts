import { FixtureAdapter } from "./fixture-adapter";
import { RpcAdapter } from "./rpc-adapter";
import type { DeskAdapter } from "./types";

/**
 * Picks the adapter from the environment. With no vault configured the
 * dashboard runs on fixtures and says so, rather than rendering an empty shell.
 */
export function getAdapter(): DeskAdapter {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const vault = process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  const chain = process.env.NEXT_PUBLIC_CHAIN_NAME ?? "unknown chain";

  if (rpcUrl && vault) return new RpcAdapter(rpcUrl, vault, chain);
  return new FixtureAdapter();
}

export * from "./types";
export * from "./format";
