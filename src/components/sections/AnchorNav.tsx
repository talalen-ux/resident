import { NAV_LINKS } from "@/content/docs";
import { SectionRule } from "@/components/ui/SectionRule";

/** In-page anchors, in the order the method is argued. */
export function AnchorNav() {
  return (
    <nav className="flex items-center gap-6 overflow-x-auto relative py-5">
      <SectionRule delay={-2.1} />
      <span aria-hidden className="type-label text-brand-primary">
        ./
      </span>
      {NAV_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="type-eyebrow inline-flex min-h-11 items-center whitespace-nowrap text-text-secondary transition-colors hover:text-text-primary"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
