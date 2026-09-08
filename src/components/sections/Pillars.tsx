import { PillarIcon } from "@/components/ui/PillarIcon";
import { PILLARS } from "@/content/docs";

/** The three commitments the rest of the page substantiates. */
export function Pillars() {
  return (
    <section className="border-t border-rule py-xxl">
      <div className="flex flex-col gap-12 lg:flex-row">
        {PILLARS.map((item) => (
          <div key={item.eyebrow} className="flex flex-1 flex-col gap-l">
            <div className="flex items-center gap-s">
              <PillarIcon
                name={item.icon}
                className="size-4 text-brand-primary"
              />
              <span className="type-eyebrow text-brand-primary">
                {item.eyebrow}
              </span>
            </div>
            <p className="type-body-lg text-text-primary">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
