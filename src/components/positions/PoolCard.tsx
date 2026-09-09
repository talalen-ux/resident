import type { Card } from "@/lib/desk/cards";

/**
 * One pool, as an operator reads it.
 *
 * The ordering is what makes it scannable: state first (is it in range, is the
 * price real), then what it is earning, then what it is actually worth after
 * the price move, then who else is in it. A field that was not measured shows
 * as a dash — never as zero, which would read as "there was none".
 */

const money = (value: number, digits = 2) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;

/** Prices span four orders of magnitude here, so precision scales with size. */
const price = (value: number) => money(value, value < 10 ? 4 : 2);

const percent = (value: number, digits = 1) =>
  `${(value * 100).toFixed(digits)}%`;

const signed = (value: number) =>
  `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;

const ago = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
};

/** A label over a value. The dash is the whole point — see the note above. */
function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: "plain" | "good" | "bad";
}) {
  const colour =
    value === null
      ? "text-text-secondary"
      : tone === "good"
        ? "text-brand-primary"
        : tone === "bad"
          ? "text-[#a8402a]"
          : "text-text-primary";

  return (
    <div className="flex flex-col gap-1">
      <span className="type-eyebrow text-text-secondary">{label}</span>
      <span className={`type-body tabular-nums ${colour}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/**
 * The range, drawn to scale, with the price on it.
 *
 * Out of range is the state worth spotting from across a room: the position
 * still holds capital and earns nothing. The fill drops to a hairline and the
 * tick pins to the edge it has passed rather than disappearing off the end.
 */
function Range({ range }: { range: NonNullable<Card["range"]> }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-2 w-full bg-rule">
        <span
          aria-hidden
          className={
            range.inRange ? "absolute inset-0 bg-brand-fill" : "absolute inset-0"
          }
        />
        <span
          aria-hidden
          className="absolute top-[-4px] h-4 w-px bg-text-primary"
          style={{ left: `${range.position * 100}%` }}
        />
      </div>
      <div className="flex justify-between gap-3">
        <span className="type-body-sm text-text-secondary tabular-nums">
          {price(range.lower)}
        </span>
        <span className="type-body-sm text-text-primary tabular-nums">
          {price(range.price)}
        </span>
        <span className="type-body-sm text-text-secondary tabular-nums">
          {price(range.upper)}
        </span>
      </div>
    </div>
  );
}

/** How much of the position is the token, and how much is still quote. */
function Split({ split }: { split: NonNullable<Card["split"]> }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="type-eyebrow text-text-secondary">Token / quote</span>
      <div className="flex h-2 w-full overflow-hidden bg-rule">
        <span
          aria-hidden
          className="bg-text-primary"
          style={{ width: `${split.base * 100}%` }}
        />
      </div>
      <span className="type-body-sm text-text-secondary tabular-nums">
        {percent(split.base, 0)} token · {percent(split.quote, 0)} quote
      </span>
    </div>
  );
}

export function PoolCard({ card }: { card: Card }) {
  const inRange = card.range?.inRange ?? null;
  const netNegative = card.net !== null && card.net.net < 0;

  return (
    <article className="flex flex-col gap-6 border-t border-rule py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="type-h3 text-[22px] text-text-primary">{card.pair}</h3>
          <span className="type-body-sm text-text-secondary tabular-nums">
            {price(card.mark)}
          </span>
          {inRange === null ? null : (
            <span
              className={
                inRange
                  ? "type-eyebrow bg-brand-fill px-2 py-1 text-on-brand"
                  : "type-eyebrow border border-rule px-2 py-1 text-text-secondary"
              }
            >
              {inRange ? "In range" : "Out of range"}
            </span>
          )}
          {card.vsReference?.stale ? (
            <span className="type-eyebrow border border-[#a8402a] px-2 py-1 text-[#a8402a]">
              {percent(card.vsReference.deviation)} off reference
            </span>
          ) : null}
        </div>
        <span className="type-body-sm text-text-secondary">
          {card.sinceSweepMs === null
            ? "no position"
            : `swept ${ago(card.sinceSweepMs)}`}
        </span>
      </header>

      {card.range ? <Range range={card.range} /> : null}

      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
        <Field
          label="At work"
          value={card.atWork === null ? null : money(card.atWork, 0)}
        />
        <Field
          label="Fees 1h"
          value={card.fees1h === null ? null : money(card.fees1h)}
        />
        <Field
          label="Fees 24h"
          value={card.fees24h === null ? null : money(card.fees24h)}
        />
        <Field
          label="Fees inside"
          value={card.feesInside === null ? null : money(card.feesInside)}
        />
        <Field
          label="Our share"
          value={card.ourShare === null ? null : percent(card.ourShare)}
        />
        <Field
          label="Swaps / hour"
          value={card.swapsPerHour === null ? null : String(card.swapsPerHour)}
        />
        <Field
          label="Pool flow 1h"
          value={card.flow1h === null ? null : signed(card.flow1h)}
          tone={
            card.flow1h === null ? "plain" : card.flow1h >= 0 ? "good" : "bad"
          }
        />
        <Field
          label="Pool vs reference"
          value={
            card.vsReference === null
              ? null
              : `${percent(card.vsReference.deviation)} · ${card.vsReference.sources} pools`
          }
        />
      </div>

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {card.split ? <Split split={card.split} /> : null}

        {/* The figure most dashboards leave out, and the reason this one is
            worth reading: fees less what the price move cost the principal. */}
        <div className="flex flex-col gap-2">
          <span className="type-eyebrow text-text-secondary">
            Net {card.net?.window ?? "6h"} — fees less what the price cost us
          </span>
          {card.net === null ? (
            <span className="type-body text-text-secondary">
              not enough history to measure
            </span>
          ) : (
            <>
              <span
                className={`text-[26px] leading-none font-medium tracking-[-0.02em] tabular-nums ${
                  netNegative ? "text-[#a8402a]" : "text-brand-primary"
                }`}
              >
                {signed(card.net.net)}
              </span>
              <span className="type-body-sm text-text-secondary tabular-nums">
                {signed(card.net.fees)} fees {signed(card.net.principal)}{" "}
                principal
                {card.net.rate === null
                  ? ""
                  : ` · ${percent(card.net.rate, 2)} on capital`}
              </span>
            </>
          )}
        </div>
      </div>

      <p className="type-body-sm text-text-secondary">
        {card.smartLp.present} tracked providers in this pool,{" "}
        {card.smartLp.exited1h} left in the last hour,{" "}
        {card.smartLp.net >= 0
          ? `${card.smartLp.net} more winning than losing`
          : `${Math.abs(card.smartLp.net)} more losing than winning`}
        .
      </p>
    </article>
  );
}
