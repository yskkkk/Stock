import { loadStock } from "../stock-data.js";
import { detectBoxRangeOnCandles } from "./detect.js";
import { listBoxesForChartOverlaySync } from "./store.js";

/** @type {readonly ("1h"|"4h"|"1d")[]} */
const BOX_TFS = ["1h", "4h", "1d"];

/**
 * @param {string} chartTimeframe — 차트 UI 봉(1m·5m·15m·1h·4h·1d)
 * @returns {("1h"|"4h"|"1d")[]}
 */
/** 차트 봉과 무관하게 1h·4h·1d 박스 모두 탐지 — 표시 여부는 클라이언트에서 차트 봉에 맞게 필터 */
export function boxRangeTfsForChartTimeframe(_chartTimeframe) {
  return [...BOX_TFS];
}

/**
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {string} symbol
 */
async function detectBoxForTf(symbol, timeframe) {
  const data = await loadStock(symbol, timeframe, { live: true });
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  if (candles.length < 20) return null;
  const confirmed = candles.slice(0, -1);
  const detected = detectBoxRangeOnCandles(confirmed, timeframe);
  if (!detected) return null;
  return {
    boxId: `chart-detect-${timeframe}`,
    top: detected.top,
    bottom: detected.bottom,
    mid: detected.mid,
    timeframe,
    state: "idle",
    leftTime: detected.leftTime,
    rightTime: detected.rightTime,
  };
}

const STATE_RANK = { in_position: 0, armed: 1, idle: 2, closed: 9 };

/**
 * @param {string} symbol
 * @param {string} chartTimeframe
 * @param {string | null} userId
 */
/**
 * @returns {{ boxes: object[]; scan: Record<string, "found"|"none"|"error"> }}
 */
export async function buildChartBoxRangeOverlayAsync(
  symbol,
  chartTimeframe,
  userId,
) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  /** @type {Record<string, "found"|"none"|"error">} */
  const scan = { "1h": "none", "4h": "none", "1d": "none" };
  if (!sym) return { boxes: [], scan };

  const tfs = boxRangeTfsForChartTimeframe(chartTimeframe);
  /** @type {Map<string, object>} */
  const byTf = new Map();

  const uid = String(userId ?? "").trim();
  if (uid) {
    for (const b of listBoxesForChartOverlaySync(uid, sym)) {
      if (!tfs.includes(b.timeframe)) continue;
      byTf.set(b.timeframe, {
        boxId: b.boxId,
        top: b.top,
        bottom: b.bottom,
        mid: b.mid,
        timeframe: b.timeframe,
        state: b.state,
        leftTime: b.leftTime,
        rightTime: b.rightTime,
      });
      scan[b.timeframe] = "found";
    }
  }

  for (const tf of tfs) {
    try {
      const live = await detectBoxForTf(sym, tf);
      if (!live) {
        if (scan[tf] !== "found") scan[tf] = "none";
        continue;
      }
      scan[tf] = "found";
      const prev = byTf.get(tf);
      if (!prev) {
        byTf.set(tf, live);
        continue;
      }
      const prevRank = STATE_RANK[prev.state] ?? 5;
      const liveRank = STATE_RANK[live.state] ?? 5;
      if (liveRank < prevRank) byTf.set(tf, live);
      else if (prevRank >= STATE_RANK.idle)
        byTf.set(tf, { ...prev, ...live, boxId: prev.boxId, state: prev.state });
    } catch {
      scan[tf] = "error";
    }
  }

  return { boxes: [...byTf.values()].slice(0, 8), scan };
}
