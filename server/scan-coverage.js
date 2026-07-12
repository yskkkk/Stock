/**
 * 스캔 커버리지 원장(ledger) — 「어떤 스캔이 어느 영업일에 실제로 돌았는지」 SSOT.
 *
 * 각 스캔 상태 파일의 lastRuns(최근 48건)를 주기적으로 병합해 영구 원장에 축적한다.
 * lastRuns 는 48건 상한이 있어 시간이 지나면 오래된 기록이 사라지므로, 이 원장이
 * 넉넉한 기간(기본 150일) 동안 「source·market·timeframe·scanDate → 실행시각(atMs)」을 보존한다.
 *
 * 이를 통해:
 *  - 종목보관함 카드가 0개인 날이 「스캔 후 0」인지 「스캔 미실행」인지 구분(달력).
 *  - 서버 부팅 시 직전 정규장 세션에 비어 있는 스캔을 재실행(safety-net backfill).
 */

import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import {
  getKstParts,
  isKrBusinessDay,
  shiftDateKey,
} from "./kr-business-day.js";

const LEDGER_FILE = "scan-coverage-ledger.json";
const KEEP_DAYS = 150;

/**
 * @typedef {"golden_cross"|"ma_align"|"ma120_near"|"low_slope_flip"|"book_accum"|"bottom_candle"|"granville"} ScanCoverageSource
 */

/** @type {Array<{ id: ScanCoverageSource; labelKo: string; timeframes: Array<"1d"|"1wk">; loadState: () => Promise<{ lastRuns?: unknown }> }>} */
export const SCAN_COVERAGE_SOURCES = [
  {
    id: "golden_cross",
    labelKo: "골든크로스",
    timeframes: ["1d", "1wk"],
    loadState: async () =>
      (await import("./golden-cross-scan.js")).getGoldenCrossScanStateSync(),
  },
  {
    id: "ma_align",
    labelKo: "정배열",
    timeframes: ["1d", "1wk"],
    loadState: async () =>
      (await import("./ma-align-scan.js")).getMaAlignScanStateSync(),
  },
  {
    id: "ma120_near",
    labelKo: "120선 근처",
    timeframes: ["1d"],
    loadState: async () =>
      (await import("./ma120-near-scan.js")).getMa120NearScanStateSync(),
  },
  {
    // candle-low-slope·ma120 상태의 lastRuns 에는 timeframe 필드가 없어 "1d"로 기록됨.
    id: "low_slope_flip",
    labelKo: "저점 기울기",
    timeframes: ["1d"],
    loadState: async () =>
      (await import("./candle-low-slope-scan.js")).getCandleLowSlopeScanStateSync(),
  },
  {
    id: "book_accum",
    labelKo: "매집봉",
    timeframes: ["1d", "1wk"],
    loadState: async () =>
      (await import("./book-accumulation-scan.js")).getBookAccumulationScanStateSync(),
  },
  {
    id: "bottom_candle",
    labelKo: "바닥 캔들",
    timeframes: ["1d", "1wk"],
    loadState: async () =>
      (await import("./bottom-candle-scan.js")).getBottomCandleScanStateSync(),
  },
  {
    id: "granville",
    labelKo: "그랜빌",
    timeframes: ["1d"],
    loadState: async () =>
      (await import("./granville-scan.js")).getGranvilleScanStateSync(),
  },
];

const SOURCE_IDS = new Set(SCAN_COVERAGE_SOURCES.map((s) => s.id));

/** @param {unknown} raw */
function normalizeLedger(raw) {
  const runs =
    raw && typeof raw === "object" && raw.runs && typeof raw.runs === "object"
      ? raw.runs
      : {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, val] of Object.entries(runs)) {
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      out[key] = val;
    }
  }
  return {
    runs: out,
    updatedAtMs:
      raw && typeof raw === "object" && typeof raw.updatedAtMs === "number"
        ? raw.updatedAtMs
        : null,
  };
}

function readLedger() {
  return readJsonStoreSync(LEDGER_FILE, normalizeLedger, () => ({
    runs: {},
    updatedAtMs: null,
  }));
}

/** @param {"1d"|"1wk"} tf */
function normTf(tf) {
  return tf === "1wk" ? "1wk" : "1d";
}

/** @param {string} dateKey */
function isValidDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

/** US 영업일(주말 제외, 공휴일 미반영) */
function isUsWeekend(dateKey) {
  if (!isValidDateKey(dateKey)) return true;
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * 각 스캔 상태의 lastRuns 를 원장에 병합. 오래된(>KEEP_DAYS) 항목은 제거.
 * @returns {Promise<{ merged: number; total: number }>}
 */
export async function refreshScanCoverageLedger() {
  const ledger = readLedger();
  const runs = { ...ledger.runs };
  let merged = 0;

  for (const src of SCAN_COVERAGE_SOURCES) {
    let state;
    try {
      state = await src.loadState();
    } catch {
      continue;
    }
    const lastRuns = Array.isArray(state?.lastRuns) ? state.lastRuns : [];
    for (const run of lastRuns) {
      const market = run?.market === "us" ? "us" : run?.market === "kr" ? "kr" : null;
      const scanDate = typeof run?.scanDate === "string" ? run.scanDate.trim() : "";
      const atMs =
        typeof run?.atMs === "number" && Number.isFinite(run.atMs) ? run.atMs : 0;
      if (!market || !isValidDateKey(scanDate) || atMs <= 0) continue;
      const tf = normTf(run?.timeframe);
      const key = `${src.id}|${market}|${tf}|${scanDate}`;
      if (!runs[key] || runs[key] < atMs) {
        runs[key] = atMs;
        merged += 1;
      }
    }
  }

  // prune
  const cutoff = shiftDateKey(getKstParts().dateKey, -KEEP_DAYS);
  for (const key of Object.keys(runs)) {
    const dateKey = key.split("|")[3];
    if (!isValidDateKey(dateKey) || dateKey < cutoff) delete runs[key];
  }

  writeJsonStoreSync(LEDGER_FILE, { runs, updatedAtMs: Date.now() });
  return { merged, total: Object.keys(runs).length };
}

/**
 * 원장 조회(병합 없이 파일만). key = source|market|tf|dateKey
 * @returns {Record<string, number>}
 */
export function getScanCoverageRunsSync() {
  return readLedger().runs;
}

/**
 * 특정 (source, market, timeframe, dateKey) 스캔 실행 여부.
 * @param {ScanCoverageSource} source
 * @param {"kr"|"us"} market
 * @param {"1d"|"1wk"} timeframe
 * @param {string} dateKey
 */
export function wasScanCoveredSync(source, market, timeframe, dateKey) {
  const runs = getScanCoverageRunsSync();
  const atMs = runs[`${source}|${market}|${normTf(timeframe)}|${dateKey}`];
  return typeof atMs === "number" && atMs > 0 ? atMs : null;
}

/**
 * 달력 데이터 — 최근 `days`일(달력일)의 영업일별 소스별 커버리지.
 * @param {{ days?: number }} [opts]
 */
export async function getScanCoverageCalendar(opts = {}) {
  const days = Math.min(Math.max(Number(opts.days) || 45, 7), KEEP_DAYS);
  await refreshScanCoverageLedger().catch(() => {});
  const runs = getScanCoverageRunsSync();
  const nowParts = getKstParts();
  const today = nowParts.dateKey;
  const krClosedToday = nowParts.minutesOfDay >= 15 * 60 + 30;

  /**
   * 해당 (날짜, 시장) 정규장 세션이 「마감 완료」됐는지 — 완료면 미실행=누락(missing),
   * 미완료(오늘 진행 중·마감 전)면 대기(pending)로 표시.
   * @param {string} date @param {"kr"|"us"} market
   */
  function sessionComplete(date, market) {
    if (date < today) return true;
    if (date > today) return false;
    // date === today
    if (market === "kr") return krClosedToday;
    // US 정규장은 같은 KST 날짜에 마감되지 않음 → 오늘분은 대기
    return false;
  }

  /** @type {Array<{ date: string; krBusiness: boolean; usBusiness: boolean; hasMissing: boolean; sources: Record<string, { expected: Array<"kr"|"us">; ran: Array<"kr"|"us">; due: Array<"kr"|"us">; status: "ok"|"partial"|"missing"|"pending"|"na"; detail: Record<string, number> }> }> } */
  const daysOut = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDateKey(today, -i);
    const krBusiness = isKrBusinessDay(date);
    const usBusiness = !isUsWeekend(date);
    let hasMissing = false;
    /** @type {Record<string, any>} */
    const sources = {};
    for (const src of SCAN_COVERAGE_SOURCES) {
      /** @type {Array<"kr"|"us">} */
      const expected = [];
      if (krBusiness) expected.push("kr");
      if (usBusiness) expected.push("us");
      /** @type {Array<"kr"|"us">} */
      const due = expected.filter((m) => sessionComplete(date, m));
      /** @type {Array<"kr"|"us">} */
      const ran = [];
      /** @type {Record<string, number>} */
      const detail = {};
      for (const market of /** @type {Array<"kr"|"us">} */ (["kr", "us"])) {
        let any = false;
        for (const tf of src.timeframes) {
          const atMs = runs[`${src.id}|${market}|${tf}|${date}`];
          if (typeof atMs === "number" && atMs > 0) {
            any = true;
            detail[`${market}:${tf}`] = atMs;
          }
        }
        if (any) ran.push(market);
      }
      const ranDue = due.filter((m) => ran.includes(m));
      let status = /** @type {"ok"|"partial"|"missing"|"pending"|"na"} */ ("na");
      if (expected.length === 0) status = "na";
      else if (due.length === 0) status = ran.length ? "ok" : "pending";
      else if (ranDue.length === due.length) status = "ok";
      else if (ranDue.length > 0) status = "partial";
      else status = "missing";
      if (status === "missing" || status === "partial") hasMissing = true;
      sources[src.id] = { expected, ran, due, status, detail };
    }
    daysOut.push({ date, krBusiness, usBusiness, hasMissing, sources });
  }

  return {
    updatedAtMs: Date.now(),
    today,
    sources: SCAN_COVERAGE_SOURCES.map((s) => ({
      id: s.id,
      label: s.labelKo,
      timeframes: s.timeframes,
    })),
    days: daysOut,
  };
}
