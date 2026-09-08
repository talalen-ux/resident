import Link from "next/link";

import { FAQ_HEADING, FAQS } from "@/content/landing";

/**
 * Disclosures, open by default — these are what someone should read before
 * buying, so none of them sits behind a click.
 */
export function Straight() {
  return (
    <section id="risk" className="border-t border-rule py-xxl">
      <h2 className="type-h2 text-[28px] text-balance text-text-primary sm:text-[36px]">
        {FAQ_HEADING}
      </h2>

      <div className="mt-12 flex flex-col">
        {FAQS.map((faq, i) => (
          <div
            key={faq.q}
            className={`flex flex-col gap-4 py-8 md:flex-row md:gap-12 ${
              i < FAQS.length - 1 ? "border-b border-rule" : ""
            }`}
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
          the method
        </Link>
        .
      </p>
    </section>
  );
}
