import { FOOTER_NOTE } from "@/content/landing";

/** Risk note, copyright, follow prompt. */
export function SiteFooter() {
  return (
    <footer className="flex flex-col gap-6 border-t border-rule py-10">
      <p className="type-body-sm max-w-[620px] text-text-secondary">
        {FOOTER_NOTE}
      </p>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="type-eyebrow text-text-secondary">
          ©2026 – All Rights Reserved.
        </p>
        <div className="flex items-center gap-6">
          <span className="type-eyebrow text-text-secondary">Follow along</span>
          <span className="type-eyebrow text-brand-primary">::</span>
        </div>
      </div>
    </footer>
  );
}
