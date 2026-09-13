#!/usr/bin/env node
/**
 * What the desk has actually done, read from its journal.
 *
 *   npm run report -- --journal /data/keeper.ndjson
 *
 * Reads only. It opens no socket, signs nothing, and can be run against a
 * journal copied off the container.
 *
 * Two things are kept apart everywhere below, and the separation is the point:
 *
 *   MEASURED   prices, and therefore position values and divergence against
 *              holding. These come off the chain and are real whether or not
 *              the model is any good.
 *
 *   MODELLED   fee income on a paper book. A position that was never opened
 *              collects nothing, so income is the model's own estimate. It
 *              cannot validate the model, because it IS the model.
 *
 * A report that summed them into one "return" would be a track record of its
 * own assumptions, so it does not.
 */

import { existsSync, readFileSync } from "node:fs";

import { ledgerFrom, ledgerTotals } from "../src/lib/keeper/ledger.ts";
import { netOverWindow, netReturn, seriesFrom } from "../src/lib/keeper/marks.ts";
import { replay } from "../src/lib/keeper/registry.ts";
import { paperReturn } from "../src/lib/keeper/paper.ts";

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (found) return found.slice(name.length + 3);
  const flag = process.argv.indexOf(`--${name}`);
  return flag !== -1 ? process.argv[flag + 1] : fallback;
};

const path = arg("journal", process.env.RESIDENT_JOURNAL ?? ".keeper/dry-run.ndjson");
const deposit = Number(arg("deposit", process.env.RESIDENT_PAPER ?? 0));

if (!existsSync(path)) {
  console.error(`\nNo journal at ${path}.\n`);
  process.exit(1);
}

const records = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (records.length === 0) {
  console.log("\nThe journal is empty. Nothing has happened yet.\n");
  process.exit(0);
}

const state = replay(records);
const series = seriesFrom(records);
const entries = ledgerFrom(records);
const totals = ledgerTotals(entries);

const money = (n) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16);

const first = records[0].at;
const last = records[records.length - 1].at;
const days = (last - first) / 86_400_000;

console.log(`\n  ${path}`);
console.log(`  ${when(first)} to ${when(last)}  (${days.toFixed(2)} days, ${records.length} records)\n`);

// Latest mark per position, which is what the book is worth now.
const marked = state.positions.map((position) => {
  const entry = series.get(position.id);
  const mark = entry?.marks.at(-1);
  return {
    position,
    value: mark?.value ?? position.capital,
    feesUnclaimed: mark?.feesUnclaimed ?? 0,
    heldValue: mark?.heldValue ?? mark?.value ?? position.capital,
    price: mark?.price ?? null,
    marks: entry?.marks.length ?? 0,
  };
});

if (deposit > 0) {
  const committed = marked.reduce((sum, m) => sum + m.position.capital, 0);
  const book = paperReturn({
    deposit,
    cash: deposit + state.sweptTotal - committed,
    positions: marked.map((m) => ({
      capital: m.position.capital,
      value: m.value,
      feesUnclaimed: m.feesUnclaimed,
      heldValue: m.heldValue,
    })),
    feesSwept: state.sweptTotal,
  });

  // Two bottom lines, not one.
  //
  // Equity as a single figure is dominated by modelled fee income, so it reads
  // as a return when it is mostly an assumption. The measured line is what the
  // book is worth if the model's fee estimate turns out to be worth nothing,
  // and the truth is somewhere between them — which is the point of printing
  // both rather than picking one.
  const modelled = book.feesUnswept + book.feesSwept;
  const measuredEquity = book.equity - modelled;
  const measuredReturn = book.deposit > 0 ? measuredEquity / book.deposit - 1 : 0;

  console.log("  BOOK");
  console.log(`    deposit              ${money(book.deposit)}`);
  console.log(`    cash                 ${money(book.cash)}`);
  console.log(`    positions, marked    ${money(book.positionValue)}`);
  console.log(`    fees unswept         ${money(book.feesUnswept)}   modelled`);
  console.log(`    ────────────────────────────────`);
  console.log(
    `    measured only        ${money(measuredEquity)}   ${pct(measuredReturn)}` +
      `   ← if the fee model is worth nothing`,
  );
  console.log(
    `    with modelled fees   ${money(book.equity)}   ${pct(book.totalReturn)}` +
      `   ← if it is exactly right`,
  );
  console.log(
    `    vs simply holding    ${money(book.divergence)}   ← the benchmark that counts`,
  );
  console.log(
    "\n    Neither equity line is the answer. The first assumes the desk earns no\n" +
      "    fees at all, the second assumes the model's estimate is correct to the\n" +
      "    cent. And a rising price lifts both, which is why the line above is the\n" +
      "    one to read: it is what providing liquidity did against not doing it.",
  );
  console.log("");
  console.log("  WHERE IT CAME FROM");
  console.log(`    vs holding           ${money(book.divergence)}   measured`);
  console.log(`    fees, modelled       ${money(book.feesUnswept + book.feesSwept)}`);
  console.log(
    `    net of both          ${money(book.divergence + book.feesUnswept + book.feesSwept)}`,
  );
  console.log(
    "\n    Divergence is what the position is worth less what the same tokens\n" +
      "    would be worth held. It is the real cost of providing liquidity, and\n" +
      "    the modelled fees have to cover it before anything has been earned.",
  );
  // Annualising a few hours compounds noise into a number with a dozen digits,
  // and a caveat next to it does not stop anyone reading the number. Below a
  // few days it is not shown at all.
  const MIN_DAYS_TO_ANNUALISE = 3;
  if (book.deposit > 0 && days >= MIN_DAYS_TO_ANNUALISE) {
    const annualised = (book.equity / book.deposit) ** (365 / days) - 1;
    console.log(
      `\n    At this rate, annualised: ${pct(annualised)}` +
        (days < 30 ? `  (on ${days.toFixed(1)} days)` : ""),
    );
  } else if (book.deposit > 0) {
    console.log(
      `\n    Too short to annualise. ${days.toFixed(2)} of ` +
        `${MIN_DAYS_TO_ANNUALISE} days; compounding this window would produce a` +
        "\n    number with a dozen digits and none of them meaningful.",
    );
  }
  console.log("");
}

console.log("  POSITIONS");
if (marked.length === 0) {
  console.log("    none open\n");
} else {
  for (const m of marked) {
    const vsHold = m.value - m.heldValue;
    console.log(
      `    ${m.position.pool.padEnd(14)} ${m.position.probe ? "probe " : "      "}` +
        `${money(m.position.capital).padStart(11)} → ${money(m.value).padStart(11)}  ` +
        `vs hold ${money(vsHold).padStart(10)}  fees ${money(m.feesUnclaimed).padStart(9)}  ` +
        `${m.marks} marks`,
    );
  }
  console.log("");
}

console.log("  REALISED");
console.log(`    positions opened     ${totals.positions}`);
console.log(`    closed               ${totals.closed}  (${totals.winners} up, ${totals.losers} down)`);
console.log(`    fees banked          ${money(totals.feesSwept)}`);
console.log(`    realised             ${money(totals.realised)}`);
console.log(`    unrealised           ${money(totals.unrealised)}   reported apart, always`);
console.log("");

const DAY = 86_400_000;
const windows = [
  ["1h", 3_600_000],
  ["6h", 21_600_000],
  ["24h", DAY],
];
console.log("  NET BY WINDOW, PER POSITION");
let any = false;
for (const [positionId, entry] of series) {
  const position = state.positions.find((p) => p.id === positionId);
  const label = position ? position.pool : `${positionId} (closed)`;
  const cells = windows.map(([name, ms]) => {
    const net = netOverWindow(entry, ms, last);
    if (!net) return `${name} —`.padEnd(16);
    const r = netReturn(net);
    return `${name} ${money(net.net)} ${r === null ? "" : pct(r)}`.padEnd(16);
  });
  if (cells.every((c) => c.trim().endsWith("—"))) continue;
  any = true;
  console.log(`    ${label.padEnd(16)} ${cells.join(" ")}`);
}
if (!any) {
  console.log("    not enough history yet. A window needs a mark at or before its start,");
  console.log("    so a 24h figure appears 24h after the first mark and not before.");
}
console.log("");
