import { PAYOUT_STEPS, SNAPSHOT_NOTE } from "@/content/docs";
import { SectionRule } from "@/components/ui/SectionRule";

/** Where the money goes, in four steps. */
export function Payouts() {
  return (
    <section id="payouts" className="relative py-xxl">
      <SectionRule delay={-8.1} />
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span className="type-label text-brand-primary">#</span>
          <h2 className="type-label text-text-primary">Distribution mechanics</h2>
        </div>
        <div className="flex flex-1 flex-col gap-12 lg:pr-xl">
          <p className="type-h3 max-w-[708px] text-text-primary">
            Every dollar of realized profit splits the same way, and the
            contract is what enforces it.
          </p>

          <div className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {PAYOUT_STEPS.map((step) => (
              <div
                key={step.label}
                className="flex flex-col gap-3 bg-bg-primary py-5 pr-5"
              >
                <span className="type-eyebrow text-brand-primary">
                  {step.label}
                </span>
                <p className="type-body-sm text-text-secondary">{step.body}</p>
              </div>
            ))}
          </div>

          <p className="type-body text-text-secondary">{SNAPSHOT_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
