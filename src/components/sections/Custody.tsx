import { INVARIANTS } from "@/content/docs";
import { SectionRule } from "@/components/ui/SectionRule";

/**
 * Custody properties, stated as held. The last row is the one that constrains
 * nobody, so it is marked rather than buried in the middle of the table.
 */
export function Custody() {
  return (
    <section id="custody" className="relative py-xxl">
      <SectionRule delay={-9.2} />
      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex shrink-0 items-start gap-6 lg:w-[276px]">
          <span className="type-label text-brand-primary">#</span>
<h2 className="type-label text-text-primary">Custody</h2>
        </div>
        <div className="flex flex-1 flex-col gap-10 lg:pr-xl">
          <p className="type-body text-text-secondary">
            All capital — fee inflow, cash, inventory — is custodied by a single
            on-chain fund contract, publicly auditable in real time. An
            autonomous execution agent runs the operation against that contract:
            it surveys venues, routes orders, and triggers the distribution,
            while the contract constrains every action it can take. The agent
            itself holds nothing; every balance lives at the fund address.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left max-sm:block [&_tbody]:max-sm:block [&_td]:max-sm:block [&_thead]:max-sm:hidden [&_tr]:max-sm:block">
              <thead>
                <tr className="border-b border-rule">
                  <th className="type-eyebrow pb-3 pr-6 font-normal text-text-secondary">
                    Invariant
                  </th>
                  <th className="type-eyebrow pb-3 font-normal text-text-secondary">
                    Mechanism
                  </th>
                </tr>
              </thead>
              <tbody>
                {INVARIANTS.map((row) => (
                  <tr key={row.invariant} className="border-b border-rule">
                    <td className="type-body-sm py-4 pr-6 align-top text-text-primary">
                      {row.invariant}
                      {"flagged" in row && row.flagged ? (
                        <span className="type-eyebrow mt-1 block text-brand-primary">
                          [unconstrained]
                        </span>
                      ) : null}
                    </td>
                    <td className="type-body-sm py-4 align-top text-text-secondary">
                      {row.mechanism}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
