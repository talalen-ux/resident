import { cn } from "@/lib/cn";

/**
 * The content column: 1248px centred in a 1440px frame, i.e. 96px gutters at
 * full width. Every section rule spans this width, not the viewport, so the
 * container wraps the whole page rather than each section.
 */
export function Container({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1440px] px-6 md:px-12 min-[1440px]:px-24",
        className,
      )}
    >
      {children}
    </div>
  );
}
