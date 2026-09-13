/**
 * Net, computed rather than claimed.
 *
 * Every LP dashboard shows fees. Fees are the flattering half: a position can
 * be collecting handsomely while the principal underneath it loses more than
 * the fees bring in, and a page that reports the fee number alone will show a
 * losing position as a winner for as long as it keeps losing.
 *
 *   net over a window = fees earned in it − what the principal lost in it
 *
 * Both halves come out of the journal. Fees are the sweeps plus the change in
 * what is accrued and unswept; the principal is the marked value, which is
 * recorded every tick precisely so this subtraction is possible. Neither is
 * inferred, and when the journal does not reach back far enough the answer is
 * null rather than a smaller window quietly substituted for the one asked for.
 *
 * Publishing this number instead of the fee number is a decision that costs
 * something: it will sometimes be negative, in public, on a position we chose.
 * That is what makes it worth publishing.
 */

import type { JournalRecord } from "./types.ts";
import type { CaptureSample } from "../sim/capture.ts";

export type Mark = {
  at: number;
  value: number;
  feesUnclaimed: number;
  price: number;
  /** Net rate at the position's bounds. Absent on marks written before it. */
  rate?: number;
  /** Model fee income for the interval, for the capture calibration. */
  feeEstimate?: number;
  /** What the same tokens would be worth if simply held. */
  heldValue?: number;
};

/** Marks for one position, oldest first, plus the fees swept out of it. */
export type PositionSeries = {
  positionId: string;
  marks: Mark[];
  /** Sweeps, oldest first. */
  sweeps: { at: number; amount: number }[];
};

/** Group the journal into one series per position. */
export function seriesFrom(records: JournalRecord[]): Map<string, PositionSeries> {
  const series = new Map<string, PositionSeries>();
  const sweepIntents = new Map<string, string>();

  const ensure = (positionId: string): PositionSeries => {
    let existing = series.get(positionId);
    if (!existing) {
      existing = { positionId, marks: [], sweeps: [] };
      series.set(positionId, existing);
    }
    return existing;
  };

  for (const record of records) {
    if (record.kind === "mark") {
      ensure(record.positionId).marks.push({
        at: record.at,
        value: record.value,
        feesUnclaimed: record.feesUnclaimed,
        price: record.price,
        rate: record.rate,
        feeEstimate: record.feeEstimate,
        heldValue: record.heldValue,
      });
    } else if (record.kind === "intent" && record.intent.kind === "sweep") {
      sweepIntents.set(record.intent.id, record.intent.positionId);
    } else if (record.kind === "settled" && record.ok) {
      const positionId = sweepIntents.get(record.intentId);
      if (positionId !== undefined) {
        ensure(positionId).sweeps.push({
          at: record.at,
          amount: record.amount ?? 0,
        });
      }
    }
  }

  return series;
}

export type NetOverWindow = {
  /** Milliseconds the window actually covers, which may exceed what was asked. */
  windowMs: number;
  /** Fees earned inside the window: swept plus the change in what is accrued. */
  fees: number;
  /** Change in the marked principal. Negative when the price move cost us. */
  principalChange: number;
  /** fees + principalChange. The figure to publish. */
  net: number;
  /** Value at the start of the window, for expressing net as a rate. */
  openingValue: number;
};

/**
 * Net over the last `windowMs`, or null when the series does not reach back.
 *
 * The window is anchored on the oldest mark at or before the cutoff. Using the
 * oldest mark *after* the cutoff instead would silently shorten the window,
 * and a six-hour figure computed over forty minutes of history is worse than
 * no figure: it is a number that looks like the one that was asked for.
 */
export function netOverWindow(
  series: PositionSeries,
  windowMs: number,
  now: number,
): NetOverWindow | null {
  const marks = series.marks;
  if (marks.length < 2) return null;

  const cutoff = now - windowMs;
  let startIndex = -1;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].at <= cutoff) {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) return null;

  const start = marks[startIndex];
  const end = marks[marks.length - 1];

  const swept = series.sweeps
    .filter((s) => s.at > start.at && s.at <= end.at)
    .reduce((total, s) => total + s.amount, 0);

  // Fees that accrued inside the window are the ones collected plus the change
  // in what is still sitting there. A sweep drops feesUnclaimed to zero, which
  // is why the swept amount has to be added back rather than inferred from the
  // difference alone.
  const fees = swept + (end.feesUnclaimed - start.feesUnclaimed);
  const principalChange = end.value - start.value;

  return {
    windowMs: end.at - start.at,
    fees,
    principalChange,
    net: fees + principalChange,
    openingValue: start.value,
  };
}

/**
 * Net as a fraction of the capital that earned it, over the window.
 *
 * Returned separately from {@link netOverWindow} because it is the number a
 * card shows and the number most likely to be wrong by a factor: dividing by
 * the closing value rather than the opening one flatters exactly the positions
 * that lost principal, which are the ones the figure exists to expose.
 */
export function netReturn(net: NetOverWindow): number | null {
  return net.openingValue > 0 ? net.net / net.openingValue : null;
}

/**
 * Capture samples, derived from the journal.
 *
 * One sample per sweep: what the model predicted the position would earn in
 * fees across the window since the last sweep, against what the sweep actually
 * returned. Nothing else in the system can produce this — the estimate lives in
 * the marks and the outcome in the settlement, and only the journal has both.
 *
 * Without it the scanner prices every pool at the assumed 0.5 forever, and on a
 * realistic board that assumption makes every pool net-negative, so the desk
 * never opens a position and therefore never measures anything. That is a
 * deadlock, not a conservative default.
 */
export function samplesFrom(
  records: JournalRecord[],
  poolOf: (positionId: string) => string | undefined,
): CaptureSample[] {
  const series = seriesFrom(records);
  const samples: CaptureSample[] = [];

  for (const [positionId, entry] of series) {
    const pool = poolOf(positionId);
    if (!pool) continue;

    let windowStart = 0;
    for (const sweep of entry.sweeps) {
      // Marks inside this sweep's window, which is everything since the last
      // one. A sweep collects what accrued over exactly that span.
      const estimated = entry.marks
        .filter((mark) => mark.at > windowStart && mark.at <= sweep.at)
        .reduce((sum, mark) => sum + (mark.feeEstimate ?? 0), 0);
      windowStart = sweep.at;

      // A window the model said would earn nothing cannot produce a ratio.
      // capture.ts drops these too; dropping them here keeps the journal and
      // the calibration agreeing about what a sample is.
      if (!(estimated > 0)) continue;
      samples.push({ pool, estimated, realized: sweep.amount, at: sweep.at });
    }
  }

  return samples;
}
