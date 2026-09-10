"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Manual control of the keeper, gated on a wallet signature.
 *
 * The gate is not here. This asks the wallet to sign a one-time challenge and
 * hands the signature to the keeper, which checks that it recovers to the one
 * address it was configured with. A page cannot grant authority it does not
 * have, and nothing in this file is trusted by the thing holding the money.
 *
 * The session token lives in component state only. It is not written to
 * localStorage: a token that survives the tab is a token that survives someone
 * else opening it.
 */

type Position = {
  id: string;
  pool: string;
  handle: string;
  value: number;
  feesUnclaimed: number;
  unrealised: number;
  price: number;
  currentRate: number;
  inRange: boolean;
  ageIntervals: number;
};

type BoardRow = {
  pool: string;
  netApr: number;
  eligible: boolean;
  blockedBy: string | null;
  capital: number;
  capture: number;
  captureSource: string;
};

type State = {
  at: number;
  halted: string | null;
  paused: boolean;
  idleCapital: number;
  positions?: Position[];
  board?: BoardRow[];
  pending?: { kind: string }[];
};

type Ethereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ControlConsole({ endpoint }: { endpoint: string }) {
  const [address, setAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${endpoint}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      return body;
    },
    [endpoint, token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setState(await api("/control/state"));
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A session expires after an hour. Say so rather than showing a stale
      // book that the operator might act on.
      if (/sign in/.test(message)) setToken(null);
      setError(message);
    }
  }, [api, token]);

  useEffect(() => {
    if (!token) return;
    // Deferred rather than called straight from the effect: refresh sets state,
    // and doing that synchronously here cascades renders.
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [token, refresh]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const ethereum = (window as unknown as { ethereum?: Ethereum }).ethereum;
      if (!ethereum) throw new Error("No wallet found in this browser.");

      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const account = accounts[0];
      setAddress(account);

      const { nonce, message } = await api("/control/nonce");
      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [message, account],
      })) as string;

      const session = await api("/control/session", {
        method: "POST",
        body: JSON.stringify({ nonce, signature }),
      });
      setToken(session.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function order(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api("/control/order", {
        method: "POST",
        body: JSON.stringify({ ...body, note: note || "manual order" }),
      });
      setNote("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!endpoint) {
    return (
      <p className="type-body text-text-secondary">
        Set <code>NEXT_PUBLIC_KEEPER_URL</code> to the keeper&rsquo;s public URL
        to use this page.
      </p>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="type-body max-w-prose text-text-secondary">
          Connect the desk wallet and sign the challenge. The signature
          authorises nothing on chain and moves no funds; the keeper accepts it
          only if it recovers to the address it was configured with.
        </p>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="rounded-sm bg-text-primary px-5 py-2.5 type-eyebrow text-bg-primary transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {busy ? "Waiting for the wallet" : "Connect and sign"}
        </button>
        {address ? (
          <p className="type-body-sm text-text-secondary">Wallet {address}</p>
        ) : null}
        {error ? <p className="type-body-sm text-brand-primary">{error}</p> : null}
      </div>
    );
  }

  const positions = state?.positions ?? [];
  const board = state?.board ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4">
        <span className="type-body-sm text-text-secondary">
          Signed in as {address?.slice(0, 6)}…{address?.slice(-4)}
        </span>
        <span className="type-body-sm text-text-secondary">
          Idle {money(state?.idleCapital ?? 0)}
        </span>
        <button
          type="button"
          onClick={() => void order({ kind: state?.paused ? "resume" : "pause" })}
          disabled={busy}
          className="rounded-sm border border-rule px-4 py-2 type-eyebrow text-text-primary transition-colors hover:bg-bg-secondary disabled:opacity-50"
        >
          {state?.paused ? "Resume deployment" : "Pause new positions"}
        </button>
        {state?.paused ? (
          <span className="type-body-sm text-text-secondary">
            Paused. Open positions are still retired, swept and re-centred.
          </span>
        ) : null}
      </div>

      <label className="flex flex-col gap-2">
        <span className="type-eyebrow text-text-secondary">
          Why (recorded in the journal with the order)
        </span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="token is a risk to the treasury"
          className="w-full max-w-prose rounded-sm border border-rule bg-transparent px-3 py-2 type-body text-text-primary"
        />
      </label>

      <div className="flex flex-col gap-3">
        <h3 className="type-eyebrow text-text-primary">Open positions</h3>
        {positions.length === 0 ? (
          <p className="type-body-sm text-text-secondary">
            Nothing open. An empty book here means the desk holds no positions,
            not that the keeper failed to look.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse">
              <thead>
                <tr className="border-b border-rule text-left">
                  {["Pool", "Value", "Fees", "P&L", "Rate", "", ""].map((h) => (
                    <th key={h} className="py-2 type-eyebrow text-text-secondary">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id} className="border-b border-rule">
                    <td className="py-3 type-body text-text-primary">
                      {p.pool}
                      {!p.inRange ? (
                        <span className="ml-2 type-body-sm text-brand-primary">out of range</span>
                      ) : null}
                    </td>
                    <td className="py-3 type-body-sm tabular-nums">{money(p.value)}</td>
                    <td className="py-3 type-body-sm tabular-nums">{money(p.feesUnclaimed)}</td>
                    <td className="py-3 type-body-sm tabular-nums">{money(p.unrealised)}</td>
                    <td className="py-3 type-body-sm tabular-nums">
                      {(p.currentRate * 1e4).toFixed(2)} bps
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => void order({ kind: "sweep", positionId: p.id })}
                        disabled={busy}
                        className="type-eyebrow text-text-secondary underline underline-offset-4 disabled:opacity-50"
                      >
                        Sweep
                      </button>
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => void order({ kind: "close", positionId: p.id })}
                        disabled={busy}
                        className="type-eyebrow text-brand-primary underline underline-offset-4 disabled:opacity-50"
                      >
                        Exit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="type-eyebrow text-text-primary">Board</h3>
        <p className="type-body-sm max-w-prose text-text-secondary">
          Every pool the scanner ranked, including the ones its gates refused.
          Entering one the gates refused is the override; the width is still the
          model&rsquo;s.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse">
            <thead>
              <tr className="border-b border-rule text-left">
                {["Pool", "Net APR", "Capture", "Status", ""].map((h) => (
                  <th key={h} className="py-2 type-eyebrow text-text-secondary">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.map((row) => (
                <tr key={row.pool} className="border-b border-rule">
                  <td className="py-3 type-body text-text-primary">{row.pool}</td>
                  <td className="py-3 type-body-sm tabular-nums">
                    {(row.netApr * 100).toFixed(0)}%
                  </td>
                  <td className="py-3 type-body-sm tabular-nums">
                    {row.capture.toFixed(2)}
                    <span className="ml-1 text-text-secondary">{row.captureSource}</span>
                  </td>
                  <td className="py-3 type-body-sm text-text-secondary">
                    {row.eligible ? "eligible" : (row.blockedBy ?? "blocked")}
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() =>
                        void order({
                          kind: "open",
                          pool: row.pool,
                          capital: row.capital,
                        })
                      }
                      disabled={busy}
                      className="type-eyebrow text-text-primary underline underline-offset-4 disabled:opacity-50"
                    >
                      Enter {money(row.capital)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {state?.halted ? (
        <p className="type-body text-brand-primary">Keeper halted: {state.halted}</p>
      ) : null}
      {error ? <p className="type-body-sm text-brand-primary">{error}</p> : null}
      <p className="type-body-sm text-text-secondary">
        Orders are queued and applied at the top of the next tick.
        {state?.pending?.length
          ? ` ${state.pending.length} waiting.`
          : ""}
      </p>
    </div>
  );
}
