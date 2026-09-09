import { cn } from "@/lib/cn";

/**
 * The hairline between sections, with the mark travelling along it.
 *
 * The mark already has a reference line through its middle, so the section rule
 * reads as the same line running through it — and the mark eats its way along,
 * jaws working, leaving the rule clear behind it. It is the one piece of motion
 * on the site and it is decorative, so it is hidden from assistive technology
 * and stops entirely under prefers-reduced-motion, where the rule is simply a
 * rule.
 *
 * `delay` staggers instances so a page of them does not march in lockstep.
 * Negative values start the animation part-way through, which is what makes a
 * stagger look incidental rather than sequenced.
 */
export function SectionRule({
  className,
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn("rule-eat", className)}
      style={{ "--rule-delay": `${delay}s` } as React.CSSProperties}
    >
      <span className="rule-eat__line" />
      <span className="rule-eat__track">
        <span className="rule-eat__mark">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Upper jaw: the bracket tops and the block, hinged on the left. */}
            <g className="rule-eat__jaw">
              <path
                d="M13 3H3v14M23 3h10v14"
                stroke="var(--color-text-primary)"
                strokeWidth="2.5"
                strokeLinecap="square"
              />
              <rect
                x="15"
                y="8"
                width="6"
                height="6"
                fill="var(--color-brand-primary)"
              />
            </g>
            {/* Lower jaw. */}
            <g className="rule-eat__jaw rule-eat__jaw--lower">
              <path
                d="M3 19v14h10M33 19v14H23"
                stroke="var(--color-text-primary)"
                strokeWidth="2.5"
                strokeLinecap="square"
              />
            </g>
            {/* The reference line, which is the section rule passing through. */}
            <rect
              x="9"
              y="17"
              width="18"
              height="2.5"
              fill="var(--color-brand-primary)"
            />
          </svg>
        </span>
      </span>
    </div>
  );
}
