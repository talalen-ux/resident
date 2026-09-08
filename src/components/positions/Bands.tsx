import type { BandPosition } from "@/lib/desk";
import { formatUnits, timeAgo, usd } from "@/lib/desk";

/**
 * Prices, not sums. Two decimal places is right for a $200 share and useless
 * for a $0.42 one, where it collapses a whole band into two ticks — and thin
 * sub-dollar names are most of what this desk trades. Scale the precision to
 * the magnitude instead.
 */
const price = (value: bigint, decimals: number) =>
  `$${formatUnits(value, decimals, value < 10n ** BigInt(decimals + 1) ? 4 : 2)}`;

/**
 * Where a band sits relative to its own range, drawn to scale.
 *
 * The bar is the range; the tick is the current price. Out-of-range positions
 * are the ones worth spotting at a glance — they hold capital but earn nothing
 * — so the tick pins to the edge it has passed rather than disappearing.
 */
function RangeBar({ band }: { band: BandPosition }) {
  const span = Number(band.upper - band.lower);
  const offset = span > 0 ? Number(band.price - band.lower) / span : 0.5;
  const clamped = Math.min(1, Math.max(0, offset));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-1.5 w-full min-w-[120px] bg-rule">
        <span
          className={band.inRange ? "absolute inset-0 bg-brand-fill" : "absolute inset-0 bg-rule"}
        />
        <span
          aria-hidden
          className="absolute top-[-3px] h-3 w-px bg-text-primary"
          style={{ left: `${clamped * 100}%` }}
        />
      </div>
      <div className="flex justify-between gap-3">
        <span className="type-body-sm text-text-secondary tabular-nums">
          {price(band.lower, 6)}
        </span>
        <span className="type-body-sm text-text-secondary tabular-nums">
          {price(band.upper, 6)}
        </span>
      </div>
    </div>
  );
}

/** Open positions. One row per band, widest column given to the range. */
export function Bands({ bands }: { bands: BandPosition[] }) {
  if (!bands.length) {
    return (
      <p className="type-body border-t border-rule pt-8 text-text-secondary">
        No open positions.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-rule">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            {["Market", "Range", "Price", "Capital", "Fees earned", "Status"].map(
              (h) => (
                <th
                  key={h}
                  className="type-eyebrow py-4 pr-6 align-top font-normal text-text-secondary last:pr-0"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.pool} className="border-b border-rule">
              <td className="py-5 pr-6 align-top">
                <div className="flex flex-col gap-1">
                  <span className="type-h5 text-text-primary">
                    {b.symbol}
                    <span className="text-text-secondary"> / {b.quote}</span>
                  </span>
                  <span className="type-body-sm text-text-secondary">
                    {b.instrument} · {(b.feeTier / 10_000).toFixed(2)}% ·{" "}
                    {timeAgo(b.openedAt)}
                  </span>
                </div>
              </td>
              <td className="w-[220px] py-5 pr-6 align-top">
                <RangeBar band={b} />
              </td>
              <td className="type-body py-5 pr-6 align-top text-text-primary tabular-nums">
                {price(b.price, 6)}
              </td>
              <td className="type-body py-5 pr-6 align-top text-text-primary tabular-nums">
                {usd(b.capital, 6)}
              </td>
              <td className="type-body py-5 pr-6 align-top text-text-primary tabular-nums">
                {usd(b.feesEarned, 6)}
              </td>
              <td className="py-5 align-top">
                <span
                  className={
                    b.inRange
                      ? "type-eyebrow bg-brand-fill px-2 py-1 text-on-brand"
                      : "type-eyebrow border border-rule px-2 py-1 text-text-secondary"
                  }
                >
                  {b.inRange ? "in range" : "out of range"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sum a field across bands. Kept here so the page never hand-rolls the maths. */
export const total = (bands: BandPosition[], key: "capital" | "feesEarned") =>
  bands.reduce((acc, b) => acc + b[key], 0n);
