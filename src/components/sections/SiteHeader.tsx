import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

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
        <Link href="/positions" className="type-eyebrow text-text-secondary hover:text-text-primary">
          Positions
        </Link>
        <Link href="/docs" className="type-eyebrow text-text-secondary hover:text-text-primary">
          Docs
        </Link>
        <a href="#" className="type-eyebrow text-brand-primary">
          Get $RES
        </a>
      </div>
    </header>
  );
}
