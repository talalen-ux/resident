"use client";

import { useState } from "react";

import { FAQS } from "@/content/docs";
import { SectionRule } from "@/components/ui/SectionRule";

/** Every question here is answered by the method above. */
export function Faqs() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faqs" className="relative pt-xl pb-xxl">
      <SectionRule delay={-11.4} />
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[600px]">
          <span className="type-label text-brand-primary">#</span>
          <h2 className="type-eyebrow text-text-primary">FAQs</h2>
        </div>
        <div className="flex flex-1 flex-col">
          {FAQS.map((faq, i) => {
            const isOpen = open === i;
            return (
              <div
                key={faq.question}
                className={`flex flex-col ${
                  i < FAQS.length - 1 ? "border-b border-rule" : ""
                } ${i === 0 ? "pb-l" : "py-l"}`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex min-h-11 w-full cursor-pointer items-start justify-between gap-6 py-1 text-left"
                >
                  <span className="type-h5 max-w-[500px] text-text-primary">
                    {faq.question}
                  </span>
                  <span
                    aria-hidden
                    className={`relative mt-1 size-5 shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-current" />
                    <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-current" />
                  </span>
                </button>
                {isOpen ? (
                  <p className="type-body mt-6 max-w-[640px] text-text-muted">
                    {faq.answer}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
