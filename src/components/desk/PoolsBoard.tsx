import { Chip } from "@/components/desk/Panel";
import type { Alert } from "@/lib/sim/opportunity";

const money = (n: number, dp = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const compact = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}m`
  : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}k`
  : `$${n.toFixed(0)}`;

/**
 * One pool. The fee estimate is the headline because it is the ranking figure,
 * and the band line sits right under it because that is what the operator would
 * actually go and place.
 */
export function AlertCard({ alert, rank }: { alert: Alert; rank?: number }) {
  const failed = alert.gates.filter((g) => !g.passed);

  return (
    <article
      className={`flex flex-col gap-5 border border-rule p-6 ${alert.qualifies ? "" : "opacity-70"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-baseline gap-3">
          {rank ? (
            <span className="type-label text-brand-primary tabular-nums">
              {String(rank).padStart(2, "0")}
            </span>
          ) : null}
          <div className="flex flex-col gap-1">
            <h3 className="type-h3 text-text-primary">{alert.pair}</h3>
            <span className="type-eyebrow text-text-secondary">
              {alert.feeTier / 10_000}% · {money(alert.price, 4)}
            </span>
          </div>
        </div>
        {alert.qualifies ? (
          <Chip tone="good">qualifies</Chip>
        ) : (
          <Chip tone="muted">{failed.length === 1 ? failed[0].name : `${failed.length} gates`}</Chip>
        )}
      </div>

      {/* What a band would have earned, per window. */}
      <div className="grid grid-cols-4 gap-px bg-rule">
        {([["5m", alert.fees.m5], ["1h", alert.fees.h1], ["6h", alert.fees.h6], ["24h", alert.fees.h24]] as const).map(
          ([label, value]) => (
            <div key={label} className="flex flex-col gap-1 bg-bg-primary py-3">
              <span className="type-eyebrow text-text-secondary">{label}</span>
              <span className="text-[18px] leading-none font-medium tabular-nums text-text-primary">
                {money(value, value < 100 ? 2 : 0)}
              </span>
            </div>
          ),
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {([
          ["band share", `${(alert.share * 100).toFixed(1)}%`],
          ["in ±5%", compact(alert.inBandLiquidity)],
          ["smart LPs in", String(alert.smartLpPresent)],
          ["left in 1h", String(alert.smartLpExited1h)],
        ] as const).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="type-eyebrow text-text-secondary">{label}</dt>
            <dd className="type-body-sm tabular-nums text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <span className="type-eyebrow text-text-secondary">Band the operator would add</span>
        <code className="type-label overflow-x-auto text-[13px] normal-case whitespace-nowrap text-text-primary">
          {money(alert.bandLine.size, 0)} · {money(alert.bandLine.lower, 4)} → {money(alert.bandLine.upper, 4)}
        </code>
      </div>

      <ul className="flex flex-col gap-1.5 border-t border-rule pt-4">
        {alert.gates.map((g) => (
          <li key={g.name} className="type-body-sm flex gap-3">
            <span
              aria-hidden
              className={g.passed ? "text-brand-primary" : "text-text-secondary"}
            >
              {g.passed ? "✓" : "✗"}
            </span>
            <span className={g.passed ? "text-text-secondary" : "text-text-primary"}>
              <span className="text-text-primary">{g.name}</span>
              {" — "}
              {g.detail}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
