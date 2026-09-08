import Link from "next/link";

import { Container } from "@/components/layout/Container";
import { Chip, Panel } from "@/components/desk/Panel";
import { AlertCard } from "@/components/desk/PoolsBoard";
import { Mark } from "@/components/ui/Logo";
import { missingKeys } from "@/lib/chain";
import { FixturePoolsSource, loadBoard } from "@/lib/desk/pools-adapter";
import { timeAgo } from "@/lib/desk";

export const metadata = {
  title: "Pools",
  robots: { index: false, follow: false },
  description:
    "Pools where a $10k band would earn the most right now: thin liquidity, heavy volume, LPs winning.",
};

export const dynamic = "force-dynamic";

export default async function PoolsPage() {
  const board = await loadBoard(new FixturePoolsSource());
  const missing = missingKeys();

  return (
    <Container className="pb-xxl">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-4 py-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Resident home">
          <Mark className="size-7" />
          <span className="text-[20px] leading-none font-semibold tracking-[-0.4px] text-text-primary">
            Resident
          </span>
        </Link>
        <Link href="/desk" className="type-eyebrow text-text-secondary hover:text-text-primary">
          / desk
        </Link>
        <span className="type-eyebrow text-text-primary">/ pools</span>
        <div className="ml-auto flex items-center gap-3">
          {board.isFixture ? <Chip tone="warn">fixture data</Chip> : <Chip tone="good">live</Chip>}
          <span className="type-body-sm text-text-secondary">
            {timeAgo(board.generatedAt)}
          </span>
        </div>
      </header>

      <section className="flex flex-col gap-4 border-t-4 border-brand-fill pt-8">
        <h1 className="type-h2 max-w-[720px] text-[28px] text-balance text-text-primary sm:text-[36px]">
          Pools where a ${(board.config.bandSize / 1000).toFixed(0)}k band would earn the most right
          now
        </h1>
        <p className="type-body max-w-[620px] text-text-secondary">
          Thin liquidity, heavy volume, LPs winning.
        </p>
        <p className="type-body-sm max-w-[620px] border-l-2 border-text-primary pl-4 text-text-primary">
          Fee figures are an <strong className="font-semibold">upper bound</strong>, not an
          estimate. They assume every unit of pool flow crosses the band at full
          share. Against live positions, one at 13.3% share captured 14.5% of
          this figure; one at 89.1% share captured nearly all of it. Capture
          falls as share falls. They also exclude divergence loss, which on
          observed positions ran −7% to −16% of capital.
        </p>
        <p className="type-body-sm border-l-2 border-brand-primary pl-4 text-text-primary">
          The desk never opens these by itself. Every one is a decision for the
          operator.
        </p>
      </section>

      {board.isFixture ? (
        <p className="type-body-sm mt-8 border-l-2 border-text-primary bg-bg-secondary px-5 py-4 text-text-primary">
          <strong className="font-semibold">Every pool below is invented.</strong>{" "}
          Robinhood Chain is not configured, so this board is running on
          fixtures.{" "}
          {missing.length ? (
            <>
              Missing{" "}
              {missing.map((key, i) => (
                <span key={key}>
                  {i > 0 ? ", " : ""}
                  <code>{key}</code>
                </span>
              ))}
              . Volume and LP history also need an indexer — see{" "}
              <code>INTEGRATIONS.md</code>.
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-col gap-xl pt-12">
        <Panel
          title={`Qualifying — ${board.qualifying.length}`}
          hint="ranked by trailing-hour fee estimate"
        >
          {board.qualifying.length ? (
            <div className="grid grid-cols-1 gap-px lg:grid-cols-2">
              {board.qualifying.map((alert, i) => (
                <AlertCard key={alert.address} alert={alert} rank={i + 1} />
              ))}
            </div>
          ) : (
            <p className="type-body-sm text-text-secondary">
              Nothing qualifies right now. That is a normal state.
            </p>
          )}
        </Panel>

        <Panel
          title={`Not qualifying — ${board.rejected.length}`}
          hint="kept for 24h, so a spike that has passed is still readable"
        >
          <div className="grid grid-cols-1 gap-px lg:grid-cols-2">
            {board.rejected.map((alert) => (
              <AlertCard key={alert.address} alert={alert} />
            ))}
          </div>
        </Panel>

        <Panel title="Gates" hint="a pool must clear all six">
          <ul className="type-body-sm grid grid-cols-1 gap-2 text-text-secondary sm:grid-cols-2">
            <li>Hook-free, with a real LP fee</li>
            <li>At least ${(board.config.minVolume1h / 1000).toFixed(0)}k traded in the last hour</li>
            <li>
              Liquidity within ±{board.config.bandHalfWidth * 100}% under $
              {(board.config.maxBandLiquidity / 1000).toFixed(0)}k
            </li>
            <li>Still above {board.config.minPeakFraction * 100}% of the 24h peak</li>
            <li>At least {board.config.minAgeMinutes} minutes old</li>
            <li>Smart-LP tracker shows liquidity providers winning</li>
          </ul>
        </Panel>
      </div>
    </Container>
  );
}
