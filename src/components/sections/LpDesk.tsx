import { LP_BANDS, LP_EXPOSURE } from "@/content/docs";

/**
 * The two position shapes. They are alternatives, not stages, so they sit side
 * by side on one baseline rather than in a numbered sequence.
 */
export function LpDesk() {
  return (
    <section id="lp-desk" className="border-t border-rule py-xxl">
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span className="type-label text-brand-primary">#</span>
          <h2 className="type-label text-text-primary">The two shapes</h2>
        </div>
        <div className="flex flex-1 flex-col gap-16">
          <p className="type-h3 max-w-[708px] text-text-primary">
            There are two ways a position gets placed, and the difference is
            simply where it sits relative to today&rsquo;s price.
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
                <p className="type-body-sm bg-bg-secondary px-4 py-3 text-text-primary">
                  {band.range}
                </p>
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
