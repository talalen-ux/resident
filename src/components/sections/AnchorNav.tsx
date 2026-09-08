import { NAV_LINKS } from "@/content/docs";

/** In-page anchors, in the order the method is argued. */
export function AnchorNav() {
  return (
    <nav className="flex items-center gap-6 overflow-x-auto border-t border-rule py-5">
      <span aria-hidden className="type-label text-brand-primary">
        ./
      </span>
      {NAV_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="type-eyebrow whitespace-nowrap text-text-secondary transition-colors hover:text-text-primary"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
