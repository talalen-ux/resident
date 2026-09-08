import { LP_BANDS, LP_EXPOSURE } from "@/content/docs";

/**
 * The three band shapes. They are alternatives, not stages, so they sit
 * side by side on one baseline rather than in a numbered sequence.
 */
export function LpDesk() {
  return (
    <section id="lp-desk" className="border-t border-rule py-xxl">
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span className="type-label text-brand-primary">#</span>
          <h2 className="type-label text-text-primary">The LP desk</h2>
        </div>
        <div className="flex flex-1 flex-col gap-16">
          <p className="type-h3 max-w-[708px] text-text-primary">
            Where a pool carries real volume at a persistent premium, the desk
            also stands as passive liquidity.
          </p>

          <div className="grid grid-cols-1 gap-px bg-rule md:grid-cols-3">
            {LP_BANDS.map((band) => (
              <article
                key={band.mode}
                className="flex flex-col gap-5 bg-bg-primary p-6"
              >
                <div className="flex flex-col gap-1">
                  <span className="type-eyebrow text-brand-primary">
                    {band.mode}
                  </span>
                  <h3 className="type-h5 text-text-primary">{band.label}</h3>
                </div>
                <div className="overflow-x-auto bg-bg-secondary px-4 py-3">
                  <code className="type-label block whitespace-nowrap text-[13px] normal-case text-text-primary">
                    {band.range}
                  </code>
                </div>
                <p className="type-body-sm text-text-secondary">
                  {band.summary}
                </p>
                <ul className="flex flex-col gap-3 border-t border-rule pt-4">
                  {band.lifecycle.map((line) => (
                    <li
                      key={line}
                      className="type-body-sm flex gap-3 text-text-secondary"
                    >
                      <span aria-hidden className="text-brand-primary">
                        &gt;
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <p className="type-body max-w-[708px] text-text-secondary">
            {LP_EXPOSURE}
          </p>
        </div>
      </div>
    </section>
  );
}
