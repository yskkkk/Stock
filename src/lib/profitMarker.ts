import type { Candle, ChartTime } from "../types";

export function chartTimeToUnixSec(t: ChartTime): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }
  return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000);
}

/** entry 시각(ms)에 가장 가까운 봉 time — 차트 마커용 */
export function findChartTimeNearEntryMs(
  entryAtMs: number,
  candles: Candle[],
): ChartTime | null {
  if (!candles.length || !Number.isFinite(entryAtMs)) return null;
  const target = entryAtMs / 1000;
  let best = candles[0]!;
  let bestD = Math.abs(chartTimeToUnixSec(best.time) - target);
  for (const c of candles) {
    const d = Math.abs(chartTimeToUnixSec(c.time) - target);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.time;
}
