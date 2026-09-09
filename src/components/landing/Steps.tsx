import { STEPS, STEPS_HEADING } from "@/content/landing";
import { SectionRule } from "@/components/ui/SectionRule";

/** Three steps. It is a sequence, so it is numbered. */
export function Steps() {
  return (
    <section id="how" className="relative py-xxl">
      <SectionRule delay={-9.8} />
      <h2 className="type-h2 mx-auto max-w-[560px] text-[28px] text-balance text-text-primary sm:text-[36px] text-center">
        {STEPS_HEADING}
      </h2>

      <ol className="mt-16 grid grid-cols-1 gap-px bg-rule md:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex flex-col gap-4 bg-bg-primary p-8">
            <span className="type-label text-brand-primary tabular-nums">
              {step.n}
            </span>
            <h3 className="type-h3 text-text-primary">{step.title}</h3>
            <p className="type-body text-text-secondary">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
