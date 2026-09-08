import { cn } from "@/lib/cn";

/**
 * The Resident mark: a bracketed band, a reference line across its middle, and
 * a block sitting above that line — the deviation the desk is resident for.
 * Takes currentColor for the frame and the brand token for the reference, so it
 * follows the theme.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block shrink-0", className)}
      aria-hidden
    >
      <path
        d="M13 3H3v30h10M23 3h10v30H23"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
      />
      <rect x="9" y="17" width="18" height="2.5" fill="var(--color-brand-primary)" />
      <rect x="15" y="8" width="6" height="6" fill="var(--color-brand-primary)" />
    </svg>
  );
}

/** Mark plus wordmark. The word is live text, not outlines, so it stays selectable. */
export function Logo({
  className,
  wordClassName,
}: {
  className?: string;
  wordClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <Mark className="size-9" />
      <span
        className={cn(
          "text-[29px] leading-none font-semibold tracking-[-0.58px]",
          wordClassName,
        )}
      >
        Resident
      </span>
    </span>
  );
}
