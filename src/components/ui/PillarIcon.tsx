import { cn } from "@/lib/cn";

const PATHS = {
  /** A reference line with a mark above and below it. */
  reference: (
    <>
      <rect x="0" y="7" width="16" height="1.5" fill="currentColor" />
      <rect x="3" y="1" width="3.5" height="3.5" fill="currentColor" />
      <rect x="10" y="11.5" width="3.5" height="3.5" fill="currentColor" />
    </>
  ),
  /** A probe: an arrow driven into a bounded box. */
  probe: (
    <>
      <rect
        x="0.75"
        y="0.75"
        width="14.5"
        height="14.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M4 8h8M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </>
  ),
  /** A split: one stream dividing into two unequal parts. */
  payout: (
    <>
      <rect x="0" y="7" width="6" height="1.5" fill="currentColor" />
      <path d="M6 7.75 12 2.5M6 7.75 12 13" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="12" y="1" width="4" height="3" fill="currentColor" />
      <rect x="12" y="11.5" width="4" height="3" fill="currentColor" />
    </>
  ),
} as const;

export type PillarIconName = keyof typeof PATHS;

export function PillarIcon({
  name,
  className,
}: {
  name: PillarIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block shrink-0", className)}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
