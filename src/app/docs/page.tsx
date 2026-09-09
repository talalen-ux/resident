import Link from "next/link";

import { Container } from "@/components/layout/Container";
import { HeroBand } from "@/components/layout/HeroBand";
import { AnchorNav } from "@/components/sections/AnchorNav";
import { Custody } from "@/components/sections/Custody";
import { Cycle } from "@/components/sections/Cycle";
import { Faqs } from "@/components/sections/Faqs";
import { LpDesk } from "@/components/sections/LpDesk";
import { Method } from "@/components/sections/Method";
import { Parameters } from "@/components/sections/Parameters";
import { Payouts } from "@/components/sections/Payouts";
import { Pillars } from "@/components/sections/Pillars";
import { Signals } from "@/components/sections/Signals";
import { SiteFooter } from "@/components/sections/SiteFooter";
import { SiteHeader } from "@/components/sections/SiteHeader";
import { HERO_HEADLINE, HERO_NOTE, HERO_STANDFIRST } from "@/content/docs";

export const metadata = {
  title: "Docs",
  description:
    "How Resident selects pools, sets band width from realised volatility, tests entry on net rather than headline yield, manages open positions, and accounts for profit, with every operating parameter and the custody limits stated.",
};

/**
 * The long form. The landing page is deliberately short, so every claim it
 * makes is substantiated here instead of being cut.
 */
export default function DocsPage() {
  return (
    <Container>
      <SiteHeader />

      <HeroBand>
        <Link href="/" className="type-eyebrow inline-flex min-h-11 items-center text-on-brand/70 hover:text-on-brand">
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

      <AnchorNav />
      <Pillars />
      <Cycle />
      <Method />
      <LpDesk />
      <Signals />
      <Payouts />
      <Custody />
      <Parameters />
      <Faqs />
      <SiteFooter />
    </Container>
  );
}
