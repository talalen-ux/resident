import { HERO_HEADLINE, HERO_NOTE, HERO_STANDFIRST } from "@/content/docs";

/** The thesis, stated once, at full size. */
export function Hero() {
  return (
    <section className="border-t-8 border-brand-fill pt-11 pb-xxl">
      <h1 className="type-h1 max-w-[900px] text-[32px] leading-[36px] text-balance text-text-primary sm:text-[40px] sm:leading-[43px] lg:text-[48px] lg:leading-[51px]">
        {HERO_HEADLINE}
      </h1>
      <div className="mt-12 flex flex-col gap-6 md:flex-row md:gap-12">
        <p className="type-body-lg flex-1 text-text-primary">
          {HERO_STANDFIRST}
        </p>
        <p className="type-body text-text-secondary md:w-[276px]">{HERO_NOTE}</p>
      </div>
    </section>
  );
}
