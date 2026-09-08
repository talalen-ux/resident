import { cn } from "@/lib/cn";

/**
 * The lime hero band. Every page's hero uses this one, so the three cannot
 * drift apart the next time one of them is edited.
 *
 * Two things it encodes:
 *
 * The negative margins cancel the container's padding at each breakpoint, so
 * the fill reaches the container edge while the content inside stays on the
 * page grid, aligned with whatever follows the band.
 *
 * Everything inside inherits on-brand ink. brand-fill is a fixed lime, and the
 * page's own greys are chosen against white — text-secondary measures about
 * 2.7:1 on lime, so secondary copy inside the band must use `text-on-brand/70`
 * (≈5.9:1) rather than the token it would use anywhere else. For the same
 * reason a `bg-brand-fill` button is invisible here and has to invert to
 * `bg-on-brand text-brand-fill`.
 *
 * pt-16 is the 8px brand rule these heroes used to carry plus their old pt-14,
 * so adopting the band moved nothing below it.
 */
export function HeroBand({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "-mx-6 bg-brand-fill px-6 pt-16 pb-xl text-on-brand",
        "md:-mx-12 md:px-12 min-[1440px]:-mx-24 min-[1440px]:px-24",
        className,
      )}
    >
      {children}
    </section>
  );
}
