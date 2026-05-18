/**
 * 스크리너 매수 후보 일자별 스냅샷(한국 시간 기준 날짜 키).
 * 동일 KST 일자에는 스캔마다 병합하되, 심볼별 최초 기록(시각·가격·당일 고저)은 유지한다.
 * server/.data/picks-daily-history.json
 */
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const HISTORY_FILE = path.join(DATA_DIR, "picks-daily-history.json");
const MAX_DAYS = 160;

/**
 * @typedef {{
 *   symbol: string;
 *   name: string;
 *   price?: number | null;
 *   currency?: string | null;
 *   recordedAtMs?: number;
 *   dayHigh?: number | null;
 *   dayLow?: number | null;
 * }} SlimPick
 */
/** @typedef {{ date: string; scannedAtMs: number; kr: SlimPick[]; us: SlimPick[] }} DailyPicksRow */

/**
 * @param {number} ms
 * @returns {string} YYYY-MM-DD (Asia/Seoul)
 */
export function kstYmd(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** @param {string} ymd @returns {0-6 Sun..Sat in Asia/Seoul} */
export function weekdayKst(ymd) {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  }).format(d);
  const idx = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ].indexOf(w);
  return idx >= 0 ? idx : 0;
}

/** @param {string} ymd */
export function isWeekendKst(ymd) {
  const w = weekdayKst(ymd);
  return w === 0 || w === 6;
}

/** @param {string} ymd @param {number} delta @returns {string} */
function addCalendarDaysYmd(ymd, delta) {
  const t = new Date(`${ymd}T12:00:00+09:00`).getTime() + delta * 86400000;
  if (!Number.isFinite(t)) return ymd;
  return kstYmd(t);
}

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {{ version: number; days: DailyPicksRow[] }} */
function readHistorySync() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return { version: 1, days: [] };
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || !Array.isArray(o.days)) return { version: 1, days: [] };
    const days = o.days
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const date = typeof row.date === "string" ? row.date.trim() : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        const scannedAtMs =
          typeof row.scannedAtMs === "number" && Number.isFinite(row.scannedAtMs)
            ? row.scannedAtMs
            : 0;
        const kr = Array.isArray(row.kr) ? row.kr.map(slimFrom).filter(Boolean) : [];
        const us = Array.isArray(row.us) ? row.us.map(slimFrom).filter(Boolean) : [];
        const daily = /** @type {DailyPicksRow} */ ({ date, scannedAtMs, kr, us });
        tightenDayRowAnchors(daily);
        return daily;
      })
      .filter(Boolean);
    return { version: 1, days };
  } catch {
    return { version: 1, days: [] };
  }
}

/** @param {unknown} x @returns {SlimPick | null} */
function slimFrom(x) {
  if (!x || typeof x !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (x);
  const symbol = String(o.symbol ?? "").trim();
  if (!symbol) return null;
  const name = (String(o.name ?? "").trim()) || symbol;
  const pr = o.price;
  const price =
    typeof pr === "number" && Number.isFinite(pr) && pr > 0 ? pr : pr === 0 ? 0 : null;
  const cur = o.currency;
  const currency =
    typeof cur === "string" && cur.trim() ? cur.trim() : null;
  const ram = o.recordedAtMs;
  let recordedAtMs;
  if (typeof ram === "number" && Number.isFinite(ram) && ram > 0) {
    recordedAtMs = ram;
  } else if (typeof ram === "string" && ram.trim()) {
    const n = Number(ram.trim().replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) recordedAtMs = n;
  } else {
    recordedAtMs = undefined;
  }
  const dh = o.dayHigh;
  const dayHigh =
    typeof dh === "number" && Number.isFinite(dh) && dh > 0 ? dh : null;
  const dl = o.dayLow;
  const dayLow =
    typeof dl === "number" && Number.isFinite(dl) && dl > 0 ? dl : null;
  /** @type {SlimPick} */
  const out = { symbol, name, price, currency, dayHigh, dayLow };
  if (recordedAtMs !== undefined) out.recordedAtMs = recordedAtMs;
  return out;
}

/**
 * 동일 KST 일자 행에서 표시 시각이 최신 스캔으로만 밀리지 않도록,
 * 행·종목 기준시각을 "그날 기록된 시각 중 가장 이른 값"으로 맞춘다.
 * @param {DailyPicksRow} row
 */
function tightenDayRowAnchors(row) {
  if (!row || typeof row !== "object") return;
  const all = [...(row.kr ?? []), ...(row.us ?? [])];
  const pickTimes = all
    .map((p) => p.recordedAtMs)
    .filter((t) => typeof t === "number" && Number.isFinite(t) && t > 0);
  let rowMs =
    typeof row.scannedAtMs === "number" && Number.isFinite(row.scannedAtMs) && row.scannedAtMs > 0
      ? row.scannedAtMs
      : 0;
  let anchor = rowMs;
  if (pickTimes.length > 0) {
    const minPick = Math.min(...pickTimes);
    anchor = rowMs > 0 ? Math.min(rowMs, minPick) : minPick;
  }
  if (!(anchor > 0)) return;
  row.scannedAtMs = anchor;
  for (const p of all) {
    if (
      p.recordedAtMs == null ||
      !Number.isFinite(p.recordedAtMs) ||
      p.recordedAtMs <= 0
    ) {
      p.recordedAtMs = anchor;
    }
  }
}

function writeHistorySync(data) {
  ensureDirSync();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 0), "utf8");
}

/**
 * @param {{ symbol: string; name: string; market: string; price?: number; currency?: string; dayHigh?: number; dayLow?: number }} p
 * @param {number} recordedAtMs
 * @param {string} defaultCurrency
 * @returns {SlimPick}
 */
function toSlimPick(p, recordedAtMs, defaultCurrency) {
  const dh = p.dayHigh;
  const dl = p.dayLow;
  return {
    symbol: String(p.symbol ?? "").trim(),
    name: String(p.name ?? "").trim() || String(p.symbol ?? "").trim(),
    price:
      typeof p.price === "number" && Number.isFinite(p.price) && p.price >= 0 ? p.price : null,
    currency:
      typeof p.currency === "string" && p.currency.trim() ? p.currency.trim() : defaultCurrency,
    recordedAtMs,
    dayHigh: typeof dh === "number" && Number.isFinite(dh) && dh > 0 ? dh : null,
    dayLow: typeof dl === "number" && Number.isFinite(dl) && dl > 0 ? dl : null,
  };
}

/**
 * 같은 KST 일자 안에서는 심볼별로 최초 기록(price, recordedAtMs, dayHigh, dayLow)만 유지하고,
 * 이번 스캔에서 처음 나타난 심볼만 새 시각·가격으로 추가한다.
 * @param {SlimPick[]} existing
 * @param {SlimPick[]} incoming 이번 스캔 결과(동일 필드)
 * @param {number} scannedAtMs 이번 스캔 시각(신규 심볼의 recordedAtMs)
 * @param {number} rowEarliestMs 해당 KST 일자 행의 가장 이른 기록 시각(종목별 백필용)
 * @returns {SlimPick[]}
 */
function mergeSlimPicksForDay(existing, incoming, scannedAtMs, rowEarliestMs) {
  const backfill =
    typeof rowEarliestMs === "number" && Number.isFinite(rowEarliestMs) && rowEarliestMs > 0
      ? rowEarliestMs
      : scannedAtMs;
  const map = new Map();
  for (const p of existing) {
    if (!p || typeof p !== "object") continue;
    const k = String(p.symbol ?? "").trim().toUpperCase();
    if (!k) continue;
    const copy = { ...p };
    if (
      copy.recordedAtMs == null ||
      !Number.isFinite(copy.recordedAtMs) ||
      copy.recordedAtMs <= 0
    ) {
      copy.recordedAtMs = backfill;
    }
    map.set(k, copy);
  }
  for (const p of incoming) {
    const k = String(p.symbol ?? "").trim().toUpperCase();
    if (!k) continue;
    if (!map.has(k)) {
      map.set(k, { ...p, recordedAtMs: p.recordedAtMs ?? scannedAtMs });
    }
  }
  const out = /** @type {SlimPick[]} */ ([]);
  const used = new Set();
  for (const p of incoming) {
    const k = String(p.symbol ?? "").trim().toUpperCase();
    if (!k || used.has(k)) continue;
    used.add(k);
    const row = map.get(k);
    if (row) out.push(row);
  }
  for (const p of existing) {
    const k = String(p.symbol ?? "").trim().toUpperCase();
    if (!k || used.has(k)) continue;
    used.add(k);
    const row = map.get(k);
    if (row) out.push(row);
  }
  return out;
}

/**
 * 스캔 완료 시 호출 — 동일 KST 날짜 행에 병합하되, 심볼별 최초 스냅샷(시각·가격)은 덮어쓰지 않는다.
 * @param {{ symbol: string; name: string; market: string; price?: number; currency?: string; dayHigh?: number; dayLow?: number }[]} kr
 * @param {{ symbol: string; name: string; market: string; price?: number; currency?: string; dayHigh?: number; dayLow?: number }[]} us
 * @param {number} scannedAtMs
 */
export function recordPicksDailySnapshot(kr, us, scannedAtMs) {
  try {
    const date = kstYmd(scannedAtMs);
    const data = readHistorySync();
    const days = [...data.days];
    const slimKrNew = kr.map((p) => toSlimPick(p, scannedAtMs, "KRW"));
    const slimUsNew = us.map((p) => toSlimPick(p, scannedAtMs, "USD"));
    const idx = days.findIndex((d) => d.date === date);
    if (idx < 0) {
      const row = {
        date,
        scannedAtMs,
        kr: slimKrNew,
        us: slimUsNew,
      };
      tightenDayRowAnchors(row);
      days.push(row);
    } else {
      const prev = days[idx];
      const rowEarliestMs = Math.min(
        prev.scannedAtMs > 0 && Number.isFinite(prev.scannedAtMs) ? prev.scannedAtMs : scannedAtMs,
        scannedAtMs,
      );
      const row = {
        date,
        scannedAtMs: rowEarliestMs,
        kr: mergeSlimPicksForDay(prev.kr, slimKrNew, scannedAtMs, rowEarliestMs),
        us: mergeSlimPicksForDay(prev.us, slimUsNew, scannedAtMs, rowEarliestMs),
      };
      tightenDayRowAnchors(row);
      days[idx] = row;
    }
    while (days.length > MAX_DAYS) days.shift();
    writeHistorySync({ version: 1, days });
  } catch {
    /* ignore disk errors */
  }
}

/** @returns {{ days: DailyPicksRow[] }} */
export function getPicksDailyHistoryForApi() {
  const { days } = readHistorySync();
  return { days: [...days].reverse() };
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 * @param {number | undefined | null} currentPrice
 * @param {DailyPicksRow[]} daysAsc
 */
function computePickStats(symbol, market, currentPrice, daysAsc) {
  const symU = symbol.trim().toUpperCase();
  const arrKey = market === "kr" ? "kr" : "us";

  /** @type {{ date: string; price: number | null }[]} */
  const appearances = [];
  for (const day of daysAsc) {
    const arr = day[arrKey];
    const hit = arr.find((p) => p.symbol.toUpperCase() === symU);
    if (hit) appearances.push({ date: day.date, price: hit.price ?? null });
  }

  if (appearances.length === 0) {
    return {
      consecutiveWeekdays: 0,
      firstPickDate: undefined,
      firstPickPrice: undefined,
      sinceFirstPickPct: null,
    };
  }

  const firstWithPrice = appearances.find(
    (a) => a.price != null && Number.isFinite(a.price) && a.price > 0,
  );
  const firstPickDate = firstWithPrice?.date ?? appearances[0].date;
  const firstPickPrice =
    firstWithPrice?.price != null &&
    Number.isFinite(firstWithPrice.price) &&
    firstWithPrice.price > 0
      ? firstWithPrice.price
      : null;

  let sinceFirstPickPct = null;
  if (
    firstPickPrice != null &&
    currentPrice != null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0
  ) {
    sinceFirstPickPct = ((currentPrice - firstPickPrice) / firstPickPrice) * 100;
  }

  const dateSet = new Map();
  for (const day of daysAsc) {
    const arr = day[arrKey];
    if (arr.some((p) => p.symbol.toUpperCase() === symU)) dateSet.set(day.date, true);
  }

  const anchorYmd = daysAsc[daysAsc.length - 1]?.date;
  if (!anchorYmd || !dateSet.has(anchorYmd)) {
    return {
      consecutiveWeekdays: 0,
      firstPickDate,
      firstPickPrice: firstPickPrice ?? undefined,
      sinceFirstPickPct,
    };
  }

  const dayIndex = new Map(daysAsc.map((d, i) => [d.date, i]));

  let streak = 0;
  let cur = anchorYmd;
  for (let guard = 0; guard < 420; guard++) {
    if (isWeekendKst(cur)) {
      cur = addCalendarDaysYmd(cur, -1);
      continue;
    }
    const idx = dayIndex.get(cur);
    if (idx === undefined) break;
    if (dateSet.has(cur)) streak += 1;
    else break;
    cur = addCalendarDaysYmd(cur, -1);
  }

  return {
    consecutiveWeekdays: streak,
    firstPickDate,
    firstPickPrice: firstPickPrice ?? undefined,
    sinceFirstPickPct,
  };
}

/**
 * 파일 기록 + 방금 스캔된 현재 목록(당일 파일 반영 전에도 지표 일치).
 * @param {DailyPicksRow[]} fileDaysAsc
 * @param {{ kr: unknown[]; us: unknown[]; scannedAtMs: number | null }} live
 * @returns {DailyPicksRow[]}
 */
function buildDaysAscForMetrics(fileDaysAsc, live) {
  const ms = live.scannedAtMs != null && Number.isFinite(live.scannedAtMs) ? live.scannedAtMs : Date.now();
  const date = kstYmd(ms);
  const kr = Array.isArray(live.kr) ? live.kr.map(slimFrom).filter(Boolean) : [];
  const us = Array.isArray(live.us) ? live.us.map(slimFrom).filter(Boolean) : [];
  const merged = /** @type {DailyPicksRow} */ ({ date, scannedAtMs: ms, kr, us });
  const out = [...fileDaysAsc];
  const idx = out.findIndex((d) => d.date === date);
  if (idx >= 0) out[idx] = merged;
  else out.push(merged);
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * @param {object} state
 * @param {unknown[]} state.kr
 * @param {unknown[]} state.us
 * @param {number | null} state.updatedAt
 */
export function enrichPicksStateWithHistory(state) {
  const { days: fileDays } = readHistorySync();
  const fileAsc = [...fileDays].sort((a, b) => a.date.localeCompare(b.date));
  const daysAsc = buildDaysAscForMetrics(fileAsc, {
    kr: state.kr,
    us: state.us,
    scannedAtMs: state.updatedAt,
  });

  const mapPick = (p, market) => {
    const stats = computePickStats(p.symbol, market, p.price ?? null, daysAsc);
    return {
      ...p,
      pickStats: stats,
    };
  };

  return {
    ...state,
    kr: state.kr.map((p) => mapPick(p, "kr")),
    us: state.us.map((p) => mapPick(p, "us")),
  };
}
