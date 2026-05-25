import { loadStock } from "../stock-data.js";
import { detectBoxRangesProOnCandles } from "./detect-pro.js";
import { BOX_RANGE_MAX_DETECTED } from "./constants.js";
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
 * Pine PRO 다중 탐지(최대 N개) — 마지막 봉 1개만 보던 단일 앵커 탐지는 4h·1d에서
 * 최근 봉에 박스가 없으면 none으로 잘못 표시되던 원인.
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {string} symbol
 * @returns {Promise<object[]>}
 */
async function detectBoxesForTf(symbol, timeframe) {
  const data = await loadStock(symbol, timeframe, { live: true });
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  if (candles.length < 20) return [];
  const confirmed = candles.slice(0, -1);
  const detected = detectBoxRangesProOnCandles(
    confirmed,
    timeframe,
    BOX_RANGE_MAX_DETECTED,
  );
  return detected.map((b, i) => ({
    boxId: `chart-detect-${timeframe}-${i}`,
    top: b.top,
    bottom: b.bottom,
    mid: b.mid,
    timeframe,
    state: "idle",
    leftTime: b.leftTime,
    rightTime: b.rightTime,
  }));
}

/**
 * @param {string} symbol
 * @param {string} chartTimeframe
 * @param {string | null} userId
 * @returns {Promise<{ boxes: object[]; scan: Record<string, "found"|"none"|"error"> }>}
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
  /** @type {object[]} */
  const chartBoxes = [];

  const uid = String(userId ?? "").trim();
  if (uid) {
    for (const b of listBoxesForChartOverlaySync(uid, sym)) {
      if (!tfs.includes(b.timeframe)) continue;
      chartBoxes.push({
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
      const liveList = await detectBoxesForTf(sym, tf);
      if (!liveList.length) {
        if (scan[tf] !== "found") scan[tf] = "none";
        continue;
      }
      scan[tf] = "found";
      for (const live of liveList) {
        chartBoxes.push(live);
      }
    } catch {
      scan[tf] = "error";
    }
  }

  return { boxes: chartBoxes.slice(0, 24), scan };
}
