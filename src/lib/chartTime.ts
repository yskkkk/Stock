import type { Time } from "lightweight-charts";
import type { ChartTime } from "../types";

/** 정렬·비교용 unix 초 (일봉은 KST 달력일) */
export function chartTimeToSortKey(t: ChartTime): number {
  if (typeof t === "number") {
    return t > 1e12 ? Math.floor(t / 1000) : t;
  }
  return Date.UTC(t.year, t.month - 1, t.day) / 1000;
}

export function normalizeChartTime(t: ChartTime): Time {
  if (typeof t === "number") {
    const sec = t > 1e12 ? Math.floor(t / 1000) : t;
    return sec as Time;
  }
  return {
    year: Number(t.year),
    month: Number(t.month),
    day: Number(t.day),
  } as Time;
}

export function chartTimeEquals(a: ChartTime, b: ChartTime): boolean {
  if (a === b) return true;
  return chartTimeToSortKey(a) === chartTimeToSortKey(b);
}

export function chartTimeBefore(a: ChartTime, b: ChartTime): boolean {
  return chartTimeToSortKey(a) < chartTimeToSortKey(b);
}
