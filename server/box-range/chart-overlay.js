import { loadStock } from "../stock-data.js";
import { detectBoxRangesProOnCandles } from "./detect-pro.js";
import { BOX_RANGE_MAX_DETECTED } from "./constants.js";
import {
  CATALOG_MARKETS,
  readSymbolCatalogSync,
} from "./catalog-store.js";
import { normalizeBoxUnixTime, withNormalizedBoxTimes } from "./box-time.js";
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
/**
 * KR/US 카탈로그에 저장된 탐지 박스 — 차트 오버레이에 포함(기존엔 live 탐지만 반환).
 * @param {string} symbol
 */
function listCatalogBoxesForChartOverlay(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return [];
  /** @type {object[]} */
  const out = [];
  for (const market of CATALOG_MARKETS) {
    const cat = readSymbolCatalogSync(sym, market);
    if (!cat?.boxes?.length) continue;
    for (const cb of cat.boxes) {
      out.push({
        boxId: `catalog-${cb.catalogBoxId}`,
        top: cb.top,
        bottom: cb.bottom,
        mid: cb.mid,
        timeframe: cb.timeframe,
        state: cb.consumedAtMs ? "closed" : "idle",
        leftTime: cb.leftTime,
        rightTime: cb.rightTime,
      });
    }
  }
  return out;
}

function candlesForDetect(raw) {
  return raw
    .map((c) => {
      if (!c) return null;
      const time = normalizeBoxUnixTime(c.time);
      if (time == null || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
        return null;
      }
      return { ...c, time };
    })
    .filter(Boolean);
}

async function detectBoxesForTf(symbol, timeframe) {
  const data = await loadStock(symbol, timeframe, { live: true });
  const candles = candlesForDetect(
    Array.isArray(data?.candles) ? data.candles : [],
  );
  if (candles.length < 20) return [];
  const confirmed = candles.slice(0, -1);
  const detected = detectBoxRangesProOnCandles(
    confirmed,
    timeframe,
    BOX_RANGE_MAX_DETECTED,
  );
  /** @type {object[]} */
  const out = [];
  for (let i = 0; i < detected.length; i++) {
    const b = withNormalizedBoxTimes({
      boxId: `chart-detect-${timeframe}-${i}`,
      top: detected[i].top,
      bottom: detected[i].bottom,
      mid: detected[i].mid,
      timeframe,
      state: "idle",
      leftTime: detected[i].leftTime,
      rightTime: detected[i].rightTime,
    });
    if (b) out.push(b);
  }
  return out;
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
  const seenIds = new Set();

  const pushBox = (raw) => {
    const b = withNormalizedBoxTimes(raw);
    if (!b) return;
    const id = String(b.boxId ?? "").trim();
    if (!id || seenIds.has(id)) return;
    if (!tfs.includes(b.timeframe)) return;
    seenIds.add(id);
    chartBoxes.push(b);
    scan[b.timeframe] = "found";
  };

  for (const b of listCatalogBoxesForChartOverlay(sym)) {
    pushBox(b);
  }

  const uid = String(userId ?? "").trim();
  if (uid) {
    for (const b of listBoxesForChartOverlaySync(uid, sym)) {
      pushBox({
        boxId: b.boxId,
        top: b.top,
        bottom: b.bottom,
        mid: b.mid,
        timeframe: b.timeframe,
        state: b.state,
        leftTime: b.leftTime,
        rightTime: b.rightTime,
      });
    }
  }

  for (const tf of tfs) {
    try {
      const liveList = await detectBoxesForTf(sym, tf);
      if (!liveList.length) {
        if (scan[tf] !== "found") scan[tf] = "none";
        continue;
      }
      for (const live of liveList) {
        pushBox(live);
      }
    } catch {
      scan[tf] = "error";
    }
  }

  return { boxes: chartBoxes.slice(0, 24), scan };
}
