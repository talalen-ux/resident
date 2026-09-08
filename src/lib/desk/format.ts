/** Formatting helpers. Money is handled as bigint minor units end to end. */

export function formatUnits(value: bigint, decimals: number, dp = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, dp)
    .padEnd(dp, "0");

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeStr}${dp > 0 ? `.${fracStr}` : ""}`;
}

export const usd = (value: bigint, decimals: number) =>
  `$${formatUnits(value, decimals)}`;

export const pct = (fraction: number, dp = 1) =>
  `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(dp)}%`;

/** Shorten an address for display without losing its identity. */
export const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
