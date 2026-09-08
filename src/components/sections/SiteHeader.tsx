import Link from "next/link";

import { Logo } from "@/components/ui/Logo";
import { TokenCta } from "@/components/ui/TokenCta";

/** Centred masthead: logo over the utility links. */
export function SiteHeader() {
  return (
    <header className="flex flex-col items-center gap-6 py-10">
      <div className="flex items-center">
        <Link href="/" aria-label="Resident home">
          <Logo wordClassName="text-text-primary" />
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
        <Link href="/positions" className="type-eyebrow inline-flex min-h-11 items-center text-text-secondary hover:text-text-primary">
          Positions
        </Link>
        <Link href="/docs" className="type-eyebrow inline-flex min-h-11 items-center text-text-secondary hover:text-text-primary">
          Docs
        </Link>
        <TokenCta className="type-eyebrow inline-flex min-h-11 items-center text-brand-primary" />
      </div>
    </header>
  );
}
