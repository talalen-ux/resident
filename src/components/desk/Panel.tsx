import { cn } from "@/lib/cn";

/** A titled region of the dashboard. Flat by default — border, not card. */
export function Panel({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-5 border-t border-rule pt-6", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="type-eyebrow text-text-primary">{title}</h2>
        {hint ? (
          <span className="type-body-sm text-text-secondary">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled figure. Used for the ledger row, where the numbers are the point. */
export function Stat({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="type-eyebrow text-text-secondary">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          emphasis ? "text-[28px] leading-none" : "text-[20px] leading-none",
          "text-text-primary",
        )}
      >
        {value}
      </span>
      {note ? (
        <span className="type-body-sm text-text-secondary">{note}</span>
      ) : null}
    </div>
  );
}

/** State chip. Form as well as colour, so it reads without relying on hue. */
export function Chip({
  tone,
  children,
}: {
  tone: "good" | "warn" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "type-eyebrow inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-1",
        tone === "good" && "border-brand-primary text-brand-primary",
        tone === "warn" && "border-text-primary text-text-primary",
        tone === "muted" && "border-rule text-text-secondary",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0",
          tone === "good" && "bg-brand-primary",
          tone === "warn" && "bg-text-primary",
          tone === "muted" && "bg-text-secondary",
        )}
      />
      {children}
    </span>
  );
}
