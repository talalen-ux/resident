import { EDGE, EDGE_HEADING } from "@/content/landing";
import { SectionRule } from "@/components/ui/SectionRule";

/**
 * What this does that its comparables do not.
 *
 * Not a sequence, so it is not numbered: the three are independent claims and
 * any one of them stands without the others. Each is stated as a position the
 * protocol takes rather than a feature it has, and each is substantiated by a
 * number in the docs, which is the only reason it can be asserted here.
 */
export function Edge() {
  return (
    <section id="edge" className="relative py-xxl">
      <SectionRule delay={-2.7} />
      <h2 className="type-h2 max-w-[720px] text-[28px] text-balance text-text-primary sm:text-[36px]">
        {EDGE_HEADING}
      </h2>

      <div className="mt-16 flex flex-col gap-px bg-rule">
        {EDGE.map((item) => (
          <div
            key={item.label}
            className="flex flex-col gap-4 bg-bg-primary py-8 lg:flex-row lg:gap-12"
          >
            <h3 className="type-label shrink-0 text-brand-primary lg:w-[276px]">
              {item.label}
            </h3>
            <p className="type-body max-w-[640px] flex-1 text-text-secondary">
              {item.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
