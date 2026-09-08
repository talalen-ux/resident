import { Formula } from "@/components/ui/Formula";
import { PAYOUT_STEPS, SNAPSHOT_NOTE } from "@/content/docs";

/** Profit accounting: a ledger identity, stated as one. */
export function Payouts() {
  return (
    <section id="payouts" className="border-t border-rule py-xxl">
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span className="type-label text-brand-primary">#</span>
          <h2 className="type-label text-text-primary">
            Profit accounting and the distribution
          </h2>
        </div>
        <div className="flex flex-1 flex-col gap-12 lg:pr-xl">
          <p className="type-h3 max-w-[708px] text-text-primary">
            Profit is a ledger identity, not an estimate.
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

          <div className="flex flex-col gap-8">
            <Formula
              expr="O(t)  =  0.15 · Π(t)  −  D(t)"
              caption="Owed to holders: 15% of lifetime realized profit, less what has already been distributed"
            />
            <Formula
              expr="x_h  =  O · b_h / Σⱼ b_j"
              caption="Each holder's share of a distribution, over the eligible supply"
            />
          </div>

          <p className="type-body text-text-secondary">{SNAPSHOT_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
