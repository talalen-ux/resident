import { SIGNALS } from "@/content/docs";

/** What the desk watches but does not automatically act on. */
export function Signals() {
  return (
    <section id="signals" className="border-t border-rule py-xxl">
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span className="type-label text-brand-primary">#</span>
          <h2 className="type-label text-text-primary">What it watches</h2>
        </div>
        <div className="flex flex-1 flex-col gap-xl">
          {SIGNALS.map((signal, i) => (
            <article
              key={signal.title}
              className={`flex flex-col gap-6 md:flex-row md:gap-12 ${
                i > 0 ? "border-t border-rule pt-xl" : ""
              }`}
            >
              <div className="shrink-0 md:w-[200px]">
                <h3 className="type-h5 text-text-primary">{signal.title}</h3>
              </div>
              <div className="flex flex-1 flex-col gap-5">
                <p className="type-body text-text-secondary">{signal.body}</p>
                <p className="type-body-sm text-text-secondary">
                  {signal.detail}
                </p>
                <p className="type-body-sm border-l-2 border-brand-primary pl-4 text-text-primary">
                  {signal.read}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
