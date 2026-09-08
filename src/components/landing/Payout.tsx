import { PAYOUT } from "@/content/landing";

/** The money. The 15/85 split is drawn, not described. */
export function Payout() {
  return (
    <section id="payout" className="border-t border-rule py-xxl">
      <div className="flex flex-col gap-12 lg:flex-row lg:gap-24">
        <div className="flex flex-1 flex-col gap-6">
          <h2 className="type-h2 text-[28px] text-balance text-text-primary sm:text-[36px]">
            {PAYOUT.headline}
          </h2>
          <p className="type-body-lg max-w-[480px] text-text-secondary">
            {PAYOUT.body}
          </p>

          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="type-eyebrow text-text-primary">Holders</span>
              <span className="text-[20px] leading-none font-medium tabular-nums text-text-primary">
                15%
              </span>
            </div>
            <div aria-hidden className="flex h-3 w-full overflow-hidden bg-rule">
              <span className="h-full w-[15%] bg-brand-fill" />
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="type-eyebrow text-text-secondary">
                Working capital — redeployed, absorbs losses
              </span>
              <span className="type-eyebrow text-text-secondary tabular-nums">
                85%
              </span>
            </div>
          </div>
        </div>

        <dl className="grid flex-1 grid-cols-1 gap-px self-start bg-rule sm:grid-cols-2">
          {PAYOUT.points.map((p) => (
            <div key={p.label} className="flex flex-col gap-2 bg-bg-primary p-6">
              <dt className="type-eyebrow text-brand-primary">{p.label}</dt>
              <dd className="type-body-sm text-text-secondary">{p.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
