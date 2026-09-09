import { Bands, total } from "@/components/positions/Bands";
import { PoolCard } from "@/components/positions/PoolCard";
import { fixtureCards } from "@/lib/desk/cards";
import { feedStatus } from "@/lib/desk/telemetry";
import { HeroBand } from "@/components/layout/HeroBand";
import { Container } from "@/components/layout/Container";
import { SiteFooter } from "@/components/sections/SiteFooter";
import { SiteHeader } from "@/components/sections/SiteHeader";
import { getAdapter, timeAgo, usd } from "@/lib/desk";
import { SectionRule } from "@/components/ui/SectionRule";

export const metadata = {
  title: "Positions",
  description:
    "Open concentrated-liquidity positions held by the Resident protocol, the fees they have earned, and how that fee income has been split between holders and working capital.",
};

// Live protocol state. Never serve it from a static render.
export const dynamic = "force-dynamic";

/** A headline figure. Same visual weight as the hero stats on the landing page. */
function Figure({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[36px] leading-none font-medium tracking-[-0.02em] text-text-primary tabular-nums">
        {value}
      </span>
      <span className="type-eyebrow text-text-secondary">{label}</span>
      {note ? (
        <span className="type-body-sm text-text-secondary">{note}</span>
      ) : null}
    </div>
  );
}

export default async function PositionsPage() {
  const snap = await getAdapter().snapshot();
  const { bands, ledger } = snap;
  const dp = snap.vault.payoutAsset.decimals;

  const cards = fixtureCards();
  // Zero is the truth: no keeper has ever run, and the page says so rather
  // than showing a live-looking status line above illustrative figures.
  const feed = feedStatus(0, new Date(snap.readAt).getTime());

  const deployed = total(bands, "capital");
  const bandFees = total(bands, "feesEarned");
  const inRange = bands.filter((b) => b.inRange).length;

  return (
    <Container>
      <SiteHeader />

      <HeroBand>
        <h1 className="max-w-[900px] text-[40px] leading-[1.02] font-medium tracking-[-0.02em] text-balance sm:text-[56px]">
          Positions
        </h1>
        <p className="type-body-lg mt-8 max-w-[620px]">
          Every position the protocol holds, the fees each has earned, and where
          that fee income went. Read from the vault, not from a spreadsheet.
        </p>
        <p className="type-body-sm mt-6 text-on-brand/70">
          {snap.isFixture ? "Illustrative data" : snap.chain} · updated{" "}
          {timeAgo(snap.readAt)}
        </p>
      </HeroBand>

      {/* A public page showing invented figures as though they were live would
          be worse than showing nothing, so this is deliberately unmissable and
          sits above the numbers rather than in a footnote. */}
      {snap.isFixture ? (
        <p className="type-body border-l-2 border-text-primary bg-bg-secondary px-5 py-4 text-text-primary">
          <strong className="font-semibold">
            These are illustrative figures, not live data.
          </strong>{" "}
          No vault has been deployed yet, so this page is showing example
          positions to demonstrate the format. Nothing below represents capital
          at work or fees actually earned.
        </p>
      ) : null}

      <section className="flex flex-wrap gap-x-16 gap-y-8 relative py-10">
        <SectionRule delay={-5.1} />
        <Figure
          value={usd(ledger.realized, dp)}
          label="Total fees earned"
          note="Lifetime, all positions"
        />
        <Figure
          value={usd((ledger.realized * 1500n) / 10_000n, dp)}
          label="Accrued to holders"
          note={`${usd(ledger.distributed, dp)} distributed to date`}
        />
        <Figure
          value={usd(ledger.workingCapital, dp)}
          label="Working capital"
          note="Retained 85%, less losses absorbed"
        />
        <Figure
          value={usd(deployed, dp)}
          label="Currently deployed"
          note={`${bands.length} position${bands.length === 1 ? "" : "s"}, ${inRange} in range`}
        />
      </section>

      <section className="relative flex flex-col gap-6 py-10">
        <SectionRule delay={-9.4} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="type-h2 text-[28px] text-text-primary sm:text-[36px]">
            The desk
          </h2>
          {/* The keeper's own status, not the page's. A dashboard whose keeper
              died an hour ago looks exactly like one whose pools are quiet. */}
          <span className="type-body-sm text-text-secondary">
            Keeper {feed.live ? feed.note : `· ${feed.note}`}
          </span>
        </div>
        <div className="flex flex-col">
          {cards.map((card) => (
            <PoolCard key={card.address} card={card} />
          ))}
        </div>
      </section>

      <section className="relative flex flex-col gap-6 py-10 pb-xxl">
        <SectionRule delay={-1.2} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="type-h2 text-[28px] text-text-primary sm:text-[36px]">
            Open positions
          </h2>
          <span className="type-body-sm text-text-secondary">
            {usd(bandFees, dp)} earned by positions currently open
          </span>
        </div>
        <Bands bands={bands} />
        <p className="type-body-sm text-text-secondary">
          A concentrated position earns fees only while price trades inside its
          range. Positions that fall out of range are re-centered rather than
          closed at a loss.
        </p>
      </section>

      <SiteFooter />
    </Container>
  );
}
