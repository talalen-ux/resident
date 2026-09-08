import { cn } from "@/lib/cn";

/**
 * A display expression. Set in the mono face on the raised surface, and allowed
 * to scroll inside its own box so a long expression never widens the page.
 */
export function Formula({
  expr,
  caption,
  className,
}: {
  expr: string;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <div className="overflow-x-auto border-l-2 border-brand-primary bg-bg-secondary px-6 py-5">
        <code className="type-label block whitespace-nowrap text-[15px] normal-case text-text-primary">
          {expr}
        </code>
      </div>
      {caption ? (
        <figcaption className="type-eyebrow text-text-secondary">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
