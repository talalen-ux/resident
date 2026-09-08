import { Mark } from "@/components/ui/Logo";
import { TAGLINE } from "@/content/docs";

/** Oversized lockup closing the page. */
export function Wordmark() {
  return (
    <section className="flex flex-col gap-6 py-xl">
      <div className="flex items-center gap-[3vw]">
        <Mark className="h-[9vw] max-h-[120px] w-[9vw] max-w-[120px]" />
        <span className="text-[9vw] leading-none font-semibold tracking-[-0.02em] text-text-primary lg:text-[120px]">
          Resident
        </span>
      </div>
      <p className="type-body-lg text-text-secondary">{TAGLINE}</p>
    </section>
  );
}
