import { cn } from "@/lib/cn";

/**
 * The left-hand marker that opens most sections — an accent symbol followed by
 * the section name, occupying a 276px column on desktop.
 */
export function SectionLabel({
  symbol = "#",
  label,
  labelClassName,
  className,
}: {
  symbol?: string;
  label: string;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-start gap-6", className)}>
      <span className="type-label text-brand-primary">{symbol}</span>
      <span className={cn("type-eyebrow text-text-primary", labelClassName)}>
        {label}
      </span>
    </div>
  );
}
