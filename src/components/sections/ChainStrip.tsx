import { CHAIN, QUOTE, TOKEN } from "@/content/docs";
import { SectionRule } from "@/components/ui/SectionRule";

/** Token, chain and quote asset — the desk's coordinates, stated up front. */
export function ChainStrip() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 relative pt-5 pb-xl">
      <SectionRule delay={0} />
      <span className="type-body-sm text-brand-primary">{TOKEN}</span>
      <span aria-hidden className="h-px w-[39px] bg-rule" />
      <span className="type-body-sm text-text-primary">{CHAIN}</span>
      <span className="type-body-sm text-text-secondary">
        quoted in {QUOTE}
      </span>
    </div>
  );
}
