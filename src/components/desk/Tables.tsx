import { Chip } from "@/components/desk/Panel";
import type {
  Dislocation,
  Distribution,
  EligibleInstrument,
  Position,
  VaultState,
} from "@/lib/desk";
import { formatUnits, pct, short, timeAgo, usd } from "@/lib/desk";

const TH = "type-eyebrow pb-3 pr-6 font-normal text-text-secondary last:pr-0";
const TD = "type-body-sm py-3 pr-6 align-top text-text-primary last:pr-0";
const TD_NUM = `${TD} text-right tabular-nums`;

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="type-body-sm text-text-secondary">{children}</p>;
}

/** Inventory, marked against reference and against basis. */
export function PositionsTable({
  positions,
  vault,
}: {
  positions: Position[];
  vault: VaultState;
}) {
  if (!positions.length)
    return <Empty>No inventory reported. The keeper endpoint serves this table.</Empty>;

  const dp = vault.payoutAsset.decimals;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>Instrument</th>
            <th className={`${TH} text-right`}>Quantity</th>
            <th className={`${TH} text-right`}>Basis B̄</th>
            <th className={`${TH} text-right`}>Reference P̂</th>
            <th className={`${TH} text-right`}>Mark</th>
            <th className={`${TH} text-right`}>vs basis</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const over = Number(p.mark - p.basis) / Number(p.basis);
            return (
              <tr key={p.symbol} className="border-b border-rule">
                <td className={TD}>
                  <span className="font-medium">{p.symbol}</span>
                  <span className="block text-text-secondary">{p.instrument}</span>
                </td>
                <td className={TD_NUM}>{formatUnits(p.quantity, p.decimals, 0)}</td>
                <td className={TD_NUM}>{usd(p.basis, dp)}</td>
                <td className={TD_NUM}>{usd(p.reference, dp)}</td>
                <td className={TD_NUM}>{usd(p.mark, dp)}</td>
                <td className={TD_NUM}>
                  <span className={over > 0 ? "text-brand-primary" : "text-text-secondary"}>
                    {pct(over)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Candidate dislocations. Non-qualifying rows are kept rather than filtered out,
 * with the reason stated — a mirage that was rejected is the most useful thing
 * on this table, not noise to hide.
 */
export function DislocationsTable({
  rows,
  vault,
}: {
  rows: Dislocation[];
  vault: VaultState;
}) {
  if (!rows.length)
    return <Empty>No candidates in the current sweep.</Empty>;

  const dp = vault.payoutAsset.decimals;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>Symbol</th>
            <th className={`${TH} text-right`}>Deviation δ</th>
            <th className={`${TH} text-right`}>Probe Φ</th>
            <th className={`${TH} text-right`}>Depth</th>
            <th className={TH}>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.symbol}-${r.deviation}`} className="border-b border-rule">
              <td className={`${TD} font-medium`}>{r.symbol}</td>
              <td className={TD_NUM}>{pct(r.deviation)}</td>
              <td className={TD_NUM}>
                {r.probeYield === null ? (
                  <span className="text-text-secondary">no fill</span>
                ) : (
                  usd(r.probeYield, dp)
                )}
              </td>
              <td className={TD_NUM}>{usd(r.depth, dp)}</td>
              <td className={TD}>
                {r.qualifies ? (
                  <Chip tone="good">actionable</Chip>
                ) : (
                  <span className="flex flex-col items-start gap-1">
                    <Chip tone="muted">rejected</Chip>
                    <span className="text-text-secondary">{r.blockedBy}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DistributionsTable({
  rows,
  vault,
}: {
  rows: Distribution[];
  vault: VaultState;
}) {
  if (!rows.length) return <Empty>No distributions recorded yet.</Empty>;

  const dp = vault.payoutAsset.decimals;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>When</th>
            <th className={`${TH} text-right`}>Total</th>
            <th className={`${TH} text-right`}>Holders</th>
            <th className={TH}>Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.at} className="border-b border-rule">
              <td className={TD}>{timeAgo(r.at)}</td>
              <td className={TD_NUM}>{usd(r.total, dp)}</td>
              <td className={TD_NUM}>{r.recipients}</td>
              <td className={`${TD} text-text-secondary`}>{short(r.txHash)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The daily liquidity survey: what is in the program and what is not. */
export function EligibleTable({ rows }: { rows: EligibleInstrument[] }) {
  if (!rows.length) return <Empty>Survey has not run.</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>Symbol</th>
            <th className={`${TH} text-right`}>I($1k)</th>
            <th className={`${TH} text-right`}>I($10k)</th>
            <th className={TH}>Classification</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-rule">
              <td className={`${TD} font-medium`}>{r.symbol}</td>
              <td className={TD_NUM}>{pct(r.impact1k, 2)}</td>
              <td className={TD_NUM}>{pct(r.impact10k, 2)}</td>
              <td className={TD}>
                <span className="flex flex-col items-start gap-1">
                  <Chip tone={r.classification === "eligible" ? "good" : "muted"}>
                    {r.classification}
                  </Chip>
                  <span className="text-text-secondary">{r.reason}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
