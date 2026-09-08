import Link from "next/link";

import { Container } from "@/components/layout/Container";
import { LedgerRow } from "@/components/desk/LedgerRow";
import { Chip, Panel } from "@/components/desk/Panel";
import {
  DislocationsTable,
  DistributionsTable,
  EligibleTable,
  PositionsTable,
} from "@/components/desk/Tables";
import { Mark } from "@/components/ui/Logo";
import { getAdapter, short, timeAgo } from "@/lib/desk";

export const metadata = {
  title: "Desk",
  // Operator view over live vault state. Excluded in robots.ts as well; this is
  // the per-page half of the same decision.
  robots: { index: false, follow: false },
  description:
    "Operator view of the Resident vault: profit ledger, inventory, candidate dislocations, distributions and the eligible set.",
};

// The desk is live state; never serve it from a static render.
export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const adapter = getAdapter();
  const snap = await adapter.snapshot();
  const { vault, ledger } = snap;

  return (
    <Container className="pb-xxl">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-4 py-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Resident home">
          <Mark className="size-7" />
          <span className="text-[20px] leading-none font-semibold tracking-[-0.4px] text-text-primary">
            Resident
          </span>
        </Link>
        <span className="type-eyebrow text-text-secondary">/ desk</span>
        <div className="ml-auto flex items-center gap-3">
          {snap.isFixture ? (
            <Chip tone="warn">fixture data</Chip>
          ) : (
            <Chip tone="good">{snap.chain}</Chip>
          )}
          <span className="type-body-sm text-text-secondary">
            read {timeAgo(snap.readAt)}
          </span>
        </div>
      </header>

      {snap.isFixture ? (
        <p className="type-body-sm border-l-2 border-text-primary bg-bg-secondary px-5 py-4 text-text-primary">
          <strong className="font-semibold">Every figure on this page is invented.</strong>{" "}
          No vault is configured, so the dashboard is running on fixtures. Set{" "}
          <code>NEXT_PUBLIC_RPC_URL</code> and <code>NEXT_PUBLIC_VAULT_ADDRESS</code>{" "}
          to read a real deployment.
        </p>
      ) : null}

      <div className="flex flex-col gap-xl pt-10">
        <Panel
          title="Profit ledger"
          hint={`payout asset ${vault.payoutAsset.symbol}`}
        >
          <LedgerRow ledger={ledger} vault={vault} />
        </Panel>

        <Panel
          title="Candidate dislocations"
          hint="δ* = +25%, probe $50 → $25 min, depth $100 above floor"
        >
          <DislocationsTable rows={snap.dislocations} vault={vault} />
        </Panel>

        <Panel title="Inventory" hint="sells only above max(reference + ε, basis)">
          <PositionsTable positions={snap.positions} vault={vault} />
        </Panel>

        <Panel title="Distributions" hint="every 15 minutes, once $300 is owed">
          <DistributionsTable rows={snap.distributions} vault={vault} />
        </Panel>

        <Panel title="Eligible set" hint="re-estimated every 24 hours">
          <EligibleTable rows={snap.eligible} />
        </Panel>

        <Panel title="Custody" hint="the addresses everything settles at">
          <dl className="grid grid-cols-1 gap-x-12 gap-y-3 sm:grid-cols-2">
            {[
              ["Vault", vault.address],
              ["Owner", vault.owner],
              ["Keeper", vault.keeper],
              ["Payout asset", vault.payoutAsset.address],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-rule pb-3"
              >
                <dt className="type-eyebrow text-text-secondary">{label}</dt>
                <dd className="type-body-sm tabular-nums text-text-primary">
                  {short(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="type-body-sm text-text-secondary">
            The owner key can withdraw any asset at any time, with no timelock.
            The keeper cannot. Counterparty risk here is the owner key.
          </p>
        </Panel>
      </div>
    </Container>
  );
}
