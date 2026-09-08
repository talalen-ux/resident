import { cn } from "@/lib/cn";
import { TOKEN_URL } from "@/lib/site";

/**
 * "Get $RES", in both of its states.
 *
 * There is no token yet. A link to "#" looks live and does nothing when a
 * reader clicks it expecting to buy — the worst outcome of the three — so until
 * NEXT_PUBLIC_TOKEN_URL is set this renders as plain text reading "Launching
 * soon". Set that variable and every call to action on the site becomes a real
 * link, with no other change.
 */
export function TokenCta({
  className,
  soonClassName,
  label = "Get $RES",
}: {
  className?: string;
  soonClassName?: string;
  label?: string;
}) {
  if (!TOKEN_URL) {
    return (
      <span className={cn(className, soonClassName)} aria-disabled="true">
        Launching soon
      </span>
    );
  }

  return (
    <a
      href={TOKEN_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {label}
    </a>
  );
}
