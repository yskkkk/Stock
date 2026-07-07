/**
 * 종목보관 스캔 완료 여부 감사 — 일자·시장·조건별 누락 탐지
 */
import { wasGoldenCrossScannedSync } from "./golden-cross-scan.js";
import { wasMaAlignScannedSync } from "./ma-align-scan.js";
import { wasMa120NearScannedSync } from "./ma120-near-scan.js";
import { wasCandleLowSlopeScannedSync } from "./candle-low-slope-scan.js";
import { wasBookAccumulationScannedSync } from "./book-accumulation-scan.js";
import { wasBottomCandleScannedSync } from "./bottom-candle-scan.js";
import { wasBookAccumFastScannedSync } from "./book-accumulation-fast-scan.js";
import { isKrBusinessDay, shiftDateKey } from "./kr-business-day.js";
import { VAULT_SCAN_TIMEFRAMES } from "./vault-scan-timeframe.js";

/** @typedef {"golden_cross"|"ma_align"|"ma120_near"|"low_slope_flip"|"book_accum"|"bottom_candle"|"book_accum_fast"} VaultScanComponentId */

/** @typedef {{ market: "kr"|"us"; scanDate: string; component: VaultScanComponentId; timeframe?: "1d"|"1wk"; label: string }} VaultScanGap */

/**
 * @param {string} dateKey
 */
export function isUsTradingDay(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 17, 0, 0)).getUTCDay();
  return wd !== 0 && wd !== 6;
}

/**
 * @param {"kr"|"us"} market
 * @param {string} dateKey
 */
export function isMarketTradingDay(market, dateKey) {
  return market === "kr" ? isKrBusinessDay(dateKey) : isUsTradingDay(dateKey);
}

/**
 * @param {string} fromDate YYYY-MM-DD
 * @param {string} toDate YYYY-MM-DD
 */
export function listTradingDatesInRange(fromDate, toDate) {
  /** @type {string[]} */
  const out = [];
  let cur = fromDate;
  for (let i = 0; i < 400 && cur <= toDate; i++) {
    out.push(cur);
    cur = shiftDateKey(cur, 1);
  }
  return out.filter((d) => d >= fromDate && d <= toDate);
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {VaultScanComponentId} component
 * @param {"1d"|"1wk"} [timeframe]
 */
export function wasVaultScanComponentDoneSync(
  market,
  scanDate,
  component,
  timeframe = "1d",
) {
  switch (component) {
    case "golden_cross":
      return wasGoldenCrossScannedSync(market, scanDate, timeframe);
    case "ma_align":
      return wasMaAlignScannedSync(market, scanDate, timeframe);
    case "ma120_near":
      return timeframe === "1d" && wasMa120NearScannedSync(market, scanDate);
    case "low_slope_flip":
      return timeframe === "1wk" && wasCandleLowSlopeScannedSync(market, scanDate);
    case "book_accum":
      return wasBookAccumulationScannedSync(market, scanDate, timeframe);
    case "bottom_candle":
      return wasBottomCandleScannedSync(market, scanDate, timeframe);
    case "book_accum_fast":
      return wasBookAccumFastScannedSync(market, scanDate);
    default:
      return true;
  }
}

const COMPONENT_LABELS = /** @type {Record<VaultScanComponentId, string>} */ ({
  golden_cross: "골든크로스",
  ma_align: "정배열",
  ma120_near: "120선 근처",
  low_slope_flip: "저점 기울기 전환",
  book_accum: "매집봉",
  bottom_candle: "바닥캔들",
  book_accum_fast: "매집봉(고속)",
});

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @returns {VaultScanGap[]}
 */
export function findVaultScanGapsForDate(market, scanDate) {
  if (!isMarketTradingDay(market, scanDate)) return [];

  /** @type {VaultScanGap[]} */
  const gaps = [];

  for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
    for (const component of /** @type {const} */ ([
      "golden_cross",
      "ma_align",
      "book_accum",
    ])) {
      if (!wasVaultScanComponentDoneSync(market, scanDate, component, timeframe)) {
        gaps.push({
          market,
          scanDate,
          component,
          timeframe,
          label: `${COMPONENT_LABELS[component]}(${timeframe})`,
        });
      }
    }
    if (
      timeframe === "1d" &&
      !wasVaultScanComponentDoneSync(market, scanDate, "ma120_near", "1d")
    ) {
      gaps.push({
        market,
        scanDate,
        component: "ma120_near",
        timeframe: "1d",
        label: COMPONENT_LABELS.ma120_near,
      });
    }
    if (
      timeframe === "1wk" &&
      !wasVaultScanComponentDoneSync(market, scanDate, "low_slope_flip", "1wk")
    ) {
      gaps.push({
        market,
        scanDate,
        component: "low_slope_flip",
        timeframe: "1wk",
        label: COMPONENT_LABELS.low_slope_flip,
      });
    }
    if (
      !wasVaultScanComponentDoneSync(market, scanDate, "bottom_candle", timeframe)
    ) {
      gaps.push({
        market,
        scanDate,
        component: "bottom_candle",
        timeframe,
        label: `${COMPONENT_LABELS.bottom_candle}(${timeframe})`,
      });
    }
  }

  if (!wasVaultScanComponentDoneSync(market, scanDate, "book_accum_fast", "1d")) {
    gaps.push({
      market,
      scanDate,
      component: "book_accum_fast",
      label: COMPONENT_LABELS.book_accum_fast,
    });
  }

  return gaps;
}

/**
 * @param {{ fromDate: string; toDate: string; markets?: Array<"kr"|"us"> }} opts
 */
export function auditVaultScanRange(opts) {
  const markets = opts.markets ?? ["kr", "us"];
  const dates = listTradingDatesInRange(opts.fromDate, opts.toDate);
  /** @type {VaultScanGap[]} */
  const gaps = [];

  for (const scanDate of dates) {
    for (const market of markets) {
      gaps.push(...findVaultScanGapsForDate(market, scanDate));
    }
  }

  return {
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    gapCount: gaps.length,
    gaps,
    byDate: groupGapsByDate(gaps),
  };
}

/** @param {VaultScanGap[]} gaps */
export function groupGapsByDate(gaps) {
  /** @type {Record<string, VaultScanGap[]>} */
  const out = {};
  for (const gap of gaps) {
    const key = `${gap.scanDate}:${gap.market}`;
    if (!out[key]) out[key] = [];
    out[key].push(gap);
  }
  return out;
}

/**
 * @param {VaultScanGap[]} gaps
 * @param {VaultScanComponentId} [onlyComponent]
 */
export function filterVaultScanGaps(gaps, onlyComponent) {
  if (!onlyComponent) return gaps;
  return gaps.filter((g) => g.component === onlyComponent);
}
