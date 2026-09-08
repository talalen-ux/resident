import Link from "next/link";

import { HeroBand } from "@/components/layout/HeroBand";
import { TokenCta } from "@/components/ui/TokenCta";
import { HERO, HERO_STATS } from "@/content/landing";

/** One definitional claim, one paragraph, three figures. */
export function Hero() {
  return (
    <HeroBand>
      <h1 className="max-w-[900px] text-[40px] leading-[1.02] font-medium tracking-[-0.02em] text-balance sm:text-[64px] lg:text-[80px]">
        {HERO.headline}
      </h1>

      <p className="type-body-lg mt-10 max-w-[620px]">
        {HERO.sub}
      </p>

      <div className="mt-14 flex flex-wrap gap-x-16 gap-y-8 border-t border-rule pt-8">
        {HERO_STATS.map((s) => (
          <div key={s.label} className="flex flex-col gap-1.5">
            <span className="text-[36px] leading-none font-medium tracking-[-0.02em] tabular-nums">
              {s.value}
            </span>
            <span className="type-eyebrow text-on-brand/70">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-6">
        <TokenCta
          label={HERO.cta}
          className="type-eyebrow bg-on-brand px-6 py-4 text-brand-fill transition-opacity hover:opacity-85"
          soonClassName="cursor-default opacity-80"
        />
        <Link href="/docs" className="type-eyebrow text-on-brand/70 underline underline-offset-4 hover:text-on-brand">
          {HERO.secondary}
        </Link>
      </div>
    </HeroBand>
  );
}
