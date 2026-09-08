import { CADENCES, PARAMETERS, PARAMETERS_NOTE } from "@/content/docs";

/** The operating configuration, published so behaviour is predictable. */
export function Parameters() {
  return (
    <section
      id="parameters"
      className="border-t-4 border-brand-fill py-xxl"
    >
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full bg-brand-primary"
          />
          <h2 className="type-eyebrow text-text-primary">Protocol parameters</h2>
        </div>

        <div className="flex flex-1 flex-col gap-10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  <th className="type-eyebrow pb-3 pr-6 font-normal text-text-secondary">
                    Setting
                  </th>
                  <th className="type-eyebrow pb-3 font-normal text-text-secondary">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {PARAMETERS.map((row) => (
                  <tr key={row.meaning} className="border-b border-rule">
                    <td className="type-body-sm py-3 pr-6 align-top text-text-secondary">
                      {row.meaning}
                    </td>
                    <td className="type-body-sm py-3 align-top text-text-primary tabular-nums">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="grid grid-cols-1 gap-x-12 gap-y-3 sm:grid-cols-2">
            {CADENCES.map((c) => (
              <div
                key={c.label}
                className="flex items-baseline justify-between gap-4 border-b border-rule pb-3"
              >
                <dt className="type-eyebrow text-text-secondary">{c.label}</dt>
                <dd className="type-body-sm text-right text-text-primary">
                  {c.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="type-body max-w-[708px] text-text-secondary">
            {PARAMETERS_NOTE}
          </p>
        </div>
      </div>
    </section>
  );
}
