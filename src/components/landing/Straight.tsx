import Link from "next/link";

import { FAQ_HEADING, FAQS } from "@/content/landing";
import { SectionRule } from "@/components/ui/SectionRule";

/**
 * Disclosures, open by default — these are what someone should read before
 * buying, so none of them sits behind a click.
 */
export function Straight() {
  return (
    <section id="risk" className="relative py-xxl">
      <SectionRule delay={-7.4} />
      <h2 className="type-h2 text-[28px] text-balance text-text-primary sm:text-[36px]">
        {FAQ_HEADING}
      </h2>

      {/* A one-pixel gap over a rule-coloured ground, so the dividers between
          questions are the edges of boxes rather than lines under them. A fill
          needs somewhere to stop. */}
      <div className="mt-12 flex flex-col gap-px bg-rule">
        {FAQS.map((faq) => (
          <div
            key={faq.q}
            className="hover-lime-item flex flex-col gap-4 bg-bg-primary p-8 md:flex-row md:gap-12"
          >
            <h3 className="type-h3 shrink-0 text-text-primary md:w-[320px]">
              {faq.q}
            </h3>
            <p className="type-body max-w-[620px] flex-1 text-text-secondary">
              {faq.a}
            </p>
          </div>
        ))}
      </div>

      <p className="type-body-sm mt-10 text-text-secondary">
        Every parameter above is stated in full, with its value, in{" "}
        <Link href="/docs" className="text-brand-primary underline underline-offset-4">
          the docs
        </Link>
        .
      </p>
    </section>
  );
}
