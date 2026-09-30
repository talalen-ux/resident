/**
 * One JSON-RPC caller, retried on the failures that are about the node.
 *
 * This exists because there were two of them. verify-chain.mjs had its own and
 * rpc-pools-source.ts had another, so teaching one to survive a rate limit
 * taught the other nothing — and the one that was left threw `RPC 429 on
 * eth_getLogs` out of pool discovery and killed the keeper on startup.
 *
 * What is retried and what is not:
 *
 *   429, 5xx      the node is busy or briefly broken. Ask again, slower.
 *   other 4xx     a malformed request does not become well formed by being
 *                 repeated.
 *   json.error    the node answered. That is a real answer, not a failure to
 *                 reach it, and retrying would hide it.
 *
 * The delay doubles from 250ms and honours Retry-After when the node sends
 * one, because it knows its own window better than a doubling guess does.
 */

export type RpcOptions = {
  /** Attempts after the first. Default 4. */
  retries?: number;
  /** Base delay in ms, doubled per attempt. Default 250. */
  backoffMs?: number;
  /** Upper bound on any single wait. Default 10s. */
  maxWaitMs?: number;
  /** Called before each retry, for logging a slow start rather than a hang. */
  onRetry?: (info: { method: string; status: number; attempt: number; waitMs: number }) => void;
};

export type Rpc = <T>(method: string, params?: unknown[]) => Promise<T>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for a status worth asking again about. */
export const isTransient = (status: number) => status === 429 || status >= 500;

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Exported so the pacing in a chunked read can use the same curve rather than
 * inventing a second one that drifts from it.
 */
export function backoffFor(
  attempt: number,
  retryAfterSeconds: number | null,
  options: RpcOptions = {},
): number {
  const base = options.backoffMs ?? 250;
  const cap = options.maxWaitMs ?? 10_000;
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, cap);
  }
  return Math.min(base * 2 ** attempt, cap);
}

export function jsonRpc(url: string, options: RpcOptions = {}): Rpc {
  const retries = options.retries ?? 4;
  let id = 0;

  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params });

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      if (res.ok) {
        const json = (await res.json()) as { result?: T; error?: { message: string } };
        if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
        return json.result as T;
      }

      if (!isTransient(res.status) || attempt >= retries) {
        throw new Error(
          res.status === 429
            ? `RPC 429 on ${method} after ${attempt + 1} attempts — the node is rate ` +
              "limiting. Slow the caller down or point RESIDENT_RPC_URL at an endpoint " +
              "with a higher limit."
            : `RPC ${res.status} on ${method}`,
        );
      }

      const header = Number(res.headers.get("retry-after"));
      const waitMs = backoffFor(attempt, Number.isFinite(header) ? header : null, options);
      options.onRetry?.({ method, status: res.status, attempt: attempt + 1, waitMs });
      await sleep(waitMs);
    }
  };
}
