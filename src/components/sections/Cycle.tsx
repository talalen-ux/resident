import { CYCLE } from "@/content/docs";

/**
 * The capital cycle. This is a genuine sequence — fee flow only becomes a payout
 * by passing through every stage — so the steps are numbered and the terminal
 * split is drawn rather than described.
 */
export function Cycle() {
  return (
    <section id="cycle" className="border-t border-rule py-xxl">
      <div className="flex items-center gap-6 pb-16">
        <span className="type-eyebrow text-brand-primary">./</span>
        <h2 className="type-eyebrow text-text-primary">
          Capital flow
        </h2>
      </div>

      <ol className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {CYCLE.map((node, i) => (
          <li
            key={node.step}
            className="flex flex-col gap-3 bg-bg-primary p-6"
          >
            <span className="type-label text-brand-primary tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="type-h5 text-text-primary">{node.step}</h3>
            <p className="type-body-sm text-text-secondary">{node.note}</p>
          </li>
        ))}

        {/* The terminal split: the sequence ends by dividing, not continuing.
            This cell is lime in both themes, so its text takes the constant
            on-brand ink rather than the theme's own. */}
        <li className="flex flex-col gap-3 bg-brand-fill p-6 text-on-brand">
          <span className="type-label tabular-nums opacity-70">08</span>
          <h3 className="type-h5">Split</h3>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-body-sm">Holders</span>
              <span className="type-label tabular-nums">15%</span>
            </div>
            <div
              aria-hidden
              className="flex h-1.5 w-full overflow-hidden bg-on-brand/25"
            >
              <span className="h-full w-[15%] bg-on-brand" />
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-body-sm opacity-70">Working capital</span>
              <span className="type-label tabular-nums opacity-70">85%</span>
            </div>
          </div>
        </li>
      </ol>

      <p className="type-body mt-8 max-w-[708px] text-text-secondary">
        The 85% is redeployed into new positions and absorbs losses on the
        pools; it is never paid out and holders have no claim on it. The 15% is
        owed to holders and carries forward until it is paid.
      </p>
    </section>
  );
}
