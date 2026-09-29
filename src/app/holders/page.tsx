import Link from "next/link";

import { Container } from "@/components/layout/Container";
import { HeroBand } from "@/components/layout/HeroBand";
import { SiteFooter } from "@/components/sections/SiteFooter";
import { SiteHeader } from "@/components/sections/SiteHeader";
import { SectionRule } from "@/components/ui/SectionRule";
import {
  CADENCE_BODY,
  CADENCE_TITLE,
  CLOSING_BODY,
  CLOSING_TITLE,
  CUSTODY_BODY,
  CUSTODY_TITLE,
  CYCLE,
  HEADLINES,
  HERO_HEADLINE,
  HERO_NOTE,
  HERO_STANDFIRST,
  PAYOUT_BODY,
  PAYOUT_TITLE,
  RISKS,
  RISK_TITLE,
  VERIFY,
  VERIFY_INTRO,
  VERIFY_TITLE,
} from "@/content/holders";

export const metadata = {
  title: "For holders",
  description:
    "What $RES does with its trading fees, how 15% of realized profit reaches holders in USDG without staking or claiming, when distributions run, how to verify all of it on chain, and what can go wrong.",
};

/** A section heading with its eyebrow, used for every block below the hero. */
function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <p className="type-eyebrow text-text-secondary">{eyebrow}</p>
      <h2 className="type-h2 mt-4 max-w-[20ch] text-balance">{title}</h2>
    </>
  );
}

/**
 * The page someone lands on after buying the token.
 *
 * /docs is the mechanism and this is the consequence, so nothing here repeats
 * a parameter table. The order is the order the questions arrive in: what is
 * this, when am I paid, how do I check, what could go wrong.
 */
export default function HoldersPage() {
  return (
    <Container>
      <SiteHeader />

      <HeroBand>
        <Link
          href="/"
          className="type-eyebrow inline-flex min-h-11 items-center text-on-brand/70 hover:text-on-brand"
        >
          ← Back
        </Link>
        <h1 className="type-h1 mt-8 max-w-[900px] text-[32px] leading-[36px] text-balance sm:text-[40px] sm:leading-[43px] lg:text-[48px] lg:leading-[51px]">
          {HERO_HEADLINE}
        </h1>
        <div className="mt-12 flex flex-col gap-6 md:flex-row md:gap-12">
          <p className="type-body-lg flex-1">{HERO_STANDFIRST}</p>
          <p className="type-body text-on-brand/70 md:w-[276px]">{HERO_NOTE}</p>
        </div>
      </HeroBand>

      {/* The three figures, before any prose. Someone who reads nothing else
          should still leave knowing the split and that it needs no action. */}
      <section className="py-xxl">
        <div className="grid gap-10 sm:grid-cols-3 sm:gap-8">
          {HEADLINES.map((item) => (
            <div key={item.label}>
              <p className="type-h1 text-[40px] leading-none text-brand-primary lg:text-[56px]">
                {item.figure}
              </p>
              <p className="type-eyebrow mt-4 text-text-primary">{item.label}</p>
              <p className="type-body-sm mt-3 text-text-secondary">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      <SectionRule />

      <section className="py-xxl">
        <Heading eyebrow="The cycle" title="From a trade to a payout" />
        <ol className="mt-10 flex flex-col gap-8">
          {CYCLE.map((item, index) => (
            <li key={item.step} className="grid gap-3 sm:grid-cols-[3rem_1fr] sm:gap-8">
              <span className="type-eyebrow text-brand-primary tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="type-body-lg text-text-primary">{item.step}</h3>
                <p className="type-body mt-2 max-w-[62ch] text-text-secondary">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <SectionRule delay={-2} />

      <section className="py-xxl">
        <div className="flex flex-col gap-10 md:flex-row md:gap-16">
          <div className="md:w-[320px] md:shrink-0">
            <Heading eyebrow="Distributions" title={PAYOUT_TITLE} />
          </div>
          <div className="flex flex-col gap-5">
            {PAYOUT_BODY.map((paragraph) => (
              <p key={paragraph} className="type-body max-w-[62ch] text-text-secondary">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-10 md:flex-row md:gap-16">
          <div className="md:w-[320px] md:shrink-0">
            <Heading eyebrow="Cadence" title={CADENCE_TITLE} />
          </div>
          <div className="flex flex-col gap-5">
            {CADENCE_BODY.map((paragraph) => (
              <p key={paragraph} className="type-body max-w-[62ch] text-text-secondary">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      <SectionRule delay={-4} />

      <section className="py-xxl">
        <Heading eyebrow="Verification" title={VERIFY_TITLE} />
        <p className="type-body-lg mt-6 max-w-[62ch] text-text-secondary">{VERIFY_INTRO}</p>
        <dl className="mt-10 grid gap-8 sm:grid-cols-2 sm:gap-x-12">
          {VERIFY.map((item) => (
            <div key={item.what}>
              <dt className="type-body-lg text-text-primary">{item.what}</dt>
              <dd className="type-body mt-2 text-text-secondary">{item.how}</dd>
            </div>
          ))}
        </dl>
        <p className="type-body mt-10">
          <Link href="/positions" className="text-brand-primary underline underline-offset-4">
            Open positions and what they have earned
          </Link>
          <span className="text-text-secondary"> · </span>
          <Link href="/docs" className="text-brand-primary underline underline-offset-4">
            Every parameter the desk runs on
          </Link>
        </p>
      </section>

      <SectionRule delay={-6} />

      <section className="py-xxl">
        <div className="flex flex-col gap-10 md:flex-row md:gap-16">
          <div className="md:w-[320px] md:shrink-0">
            <Heading eyebrow="Custody" title={CUSTODY_TITLE} />
          </div>
          <div className="flex flex-col gap-5">
            {CUSTODY_BODY.map((paragraph) => (
              <p key={paragraph} className="type-body max-w-[62ch] text-text-secondary">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      <SectionRule delay={-8} />

      {/* Same visual weight as everything above it. A risk section set smaller
          than the upside is a risk section nobody reads. */}
      <section className="py-xxl">
        <Heading eyebrow="Risk" title={RISK_TITLE} />
        <div className="mt-10 grid gap-8 sm:grid-cols-2 sm:gap-x-12">
          {RISKS.map((item) => (
            <div key={item.risk}>
              <h3 className="type-body-lg text-text-primary">{item.risk}</h3>
              <p className="type-body mt-2 text-text-secondary">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <SectionRule delay={-10} />

      <section className="py-xxl">
        <Heading eyebrow="In one paragraph" title={CLOSING_TITLE} />
        <p className="type-body-lg mt-6 max-w-[68ch] text-text-primary">{CLOSING_BODY}</p>
      </section>

      <SiteFooter />
    </Container>
  );
}
