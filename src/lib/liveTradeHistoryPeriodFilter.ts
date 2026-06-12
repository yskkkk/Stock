import type { LiveTradeRecord } from "../api";

export function tradeKstYearMonth(atMs: number): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date(atMs));
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return {
    year: Number.isFinite(year) ? year : 0,
    month: Number.isFinite(month) ? month : 0,
  };
}

export function collectKstYears(trades: LiveTradeRecord[]): number[] {
  const set = new Set<number>();
  for (const t of trades) {
    if (!Number.isFinite(t.atMs)) continue;
    const { year } = tradeKstYearMonth(t.atMs);
    if (year > 0) set.add(year);
  }
  return [...set].sort((a, b) => b - a);
}

export function collectKstMonths(
  trades: LiveTradeRecord[],
  year: number | null,
): number[] {
  const set = new Set<number>();
  for (const t of trades) {
    if (!Number.isFinite(t.atMs)) continue;
    const { year: y, month } = tradeKstYearMonth(t.atMs);
    if (year != null && y !== year) continue;
    if (month > 0) set.add(month);
  }
  return [...set].sort((a, b) => a - b);
}

export function filterTradesByKstPeriod(
  trades: LiveTradeRecord[],
  year: number | null,
  month: number | null,
): LiveTradeRecord[] {
  if (year == null && month == null) return trades;
  return trades.filter((t) => {
    if (!Number.isFinite(t.atMs)) return false;
    const { year: y, month: m } = tradeKstYearMonth(t.atMs);
    if (year != null && y !== year) return false;
    if (month != null && m !== month) return false;
    return true;
  });
}
