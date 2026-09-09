import Link from "next/link";

import { DOCS_BLURB } from "@/content/docs";
import { SectionRule } from "@/components/ui/SectionRule";

/** Documentation prompt. */
export function DocsCta() {
  return (
    <section className="flex flex-col gap-8 relative py-xl lg:flex-row lg:gap-12">
      <SectionRule delay={-10.7} />
      <div className="flex items-center gap-6 lg:w-[600px]">
        <span className="type-label text-brand-primary">&gt;</span>
        <span className="type-label text-text-primary">Documentation</span>
      </div>
      <p className="type-body text-text-secondary lg:w-[382px]">{DOCS_BLURB}</p>
      <div className="flex flex-1 lg:justify-end">
        <Link href="/docs" className="type-eyebrow text-brand-primary">
          [read the docs]
        </Link>
      </div>
    </section>
  );
}
