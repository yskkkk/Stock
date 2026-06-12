/**
 * 국내 재무제표 — Open DART (연간·분기, 연결재무제표 CFS)
 * @see https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019018
 */
import { isKrQuoteSymbol } from "./kr-naver-quote.js";
import { formatKrEokDisplay } from "./statement-display-units.js";
import { dartApiGet, isDartEnabled, loadCorpIndex, resolveDartCorpCode } from "./dart.js";

/** 사업보고서(연간) */
export const DART_REPORT_ANNUAL = "11011";
/** 반기보고서 */
export const DART_REPORT_HALF = "11012";
/** 1분기보고서 */
export const DART_REPORT_Q1 = "11013";
/** 3분기보고서 */
export const DART_REPORT_Q3 = "11014";

const DART_FS_DIV = "CFS";
const HISTORY_YEARS = 15;
const QUARTER_HISTORY_YEARS = 5;
const PROBE_CONCURRENCY = 4;

/** @type {Map<string, { at: number; data: unknown }>} */
const cache = new Map();
const CACHE_MS = 10 * 60_000;

/** @param {string} key @param {unknown} data */
function setCache(key, data) {
  cache.set(key, { at: Date.now(), data });
}

/** @param {string} key */
function getCache(key) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.data;
}

/** @param {string} accountNm */
function isPerShareAccount(accountNm) {
  const n = String(accountNm ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return n.includes("주당") || /^(per|eps|bps)$/.test(n);
}

/** @param {unknown} raw */
export function parseDartAmount(raw) {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s || s === "-") return null;
  const neg = s.startsWith("(") && s.endsWith(")");
  const n = Number(s.replace(/[()]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * @param {string} accountNm
 * @param {number | null} amountWon
 */
export function formatDartAccountValue(accountNm, amountWon) {
  if (amountWon == null) return "—";
  if (isPerShareAccount(accountNm)) {
    const rounded = Math.round(amountWon * 100) / 100;
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(rounded);
  }
  return formatKrEokDisplay(amountWon / 1e8);
}

/**
 * @param {unknown[]} list
 * @param {"thstrm"|"frmtrm"|"bfefrmtrm"} [column]
 */
export function dartAccountsToSections(list, column = "thstrm") {
  const amountKey =
    column === "frmtrm"
      ? "frmtrm_amount"
      : column === "bfefrmtrm"
        ? "bfefrmtrm_amount"
        : "thstrm_amount";
  /** @type {Map<string, { title: string; rows: { label: string; value: string }[] }>} */
  const byStatement = new Map();

  for (const row of list ?? []) {
    if (!row || typeof row !== "object") continue;
    const accountNm = String(/** @type {{ account_nm?: string }} */ (row).account_nm ?? "").trim();
    if (!accountNm) continue;
    const sjNm = String(/** @type {{ sj_nm?: string }} */ (row).sj_nm ?? "재무제표").trim();
    const amount = parseDartAmount(/** @type {{ [k: string]: unknown }} */ (row)[amountKey]);
    const value = formatDartAccountValue(accountNm, amount);
    if (value === "—") continue;

    let section = byStatement.get(sjNm);
    if (!section) {
      section = { title: sjNm, rows: [] };
      byStatement.set(sjNm, section);
    }
    section.rows.push({ label: accountNm, value });
  }

  const order = ["재무상태표", "손익계산서", "포괄손익계산서", "현금흐름표", "자본변동표"];
  return [...byStatement.values()].sort((a, b) => {
    const ai = order.indexOf(a.title);
    const bi = order.indexOf(b.title);
    if (ai === -1 && bi === -1) return a.title.localeCompare(b.title, "ko");
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/** @param {number} year @param {number} month */
function endMsForYearMonth(year, month) {
  return Date.UTC(year, month, 0, 12, 0, 0);
}

/**
 * @param {string} corpCode
 * @param {number} year
 * @param {string} reprtCode
 */
async function fetchDartAccounts(corpCode, year, reprtCode) {
  const cacheKey = `dart:acct:${corpCode}:${year}:${reprtCode}`;
  const hit = getCache(cacheKey);
  if (hit) return hit;

  const data = await dartApiGet("/fnlttSinglAcntAll.json", {
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reprtCode,
    fs_div: DART_FS_DIV,
  });
  const list = Array.isArray(data?.list) ? data.list : [];
  setCache(cacheKey, list);
  return list;
}

/**
 * @param {string} corpCode
 * @param {number} year
 * @param {string} reprtCode
 */
async function hasDartReport(corpCode, year, reprtCode) {
  const cacheKey = `dart:probe:${corpCode}:${year}:${reprtCode}`;
  const hit = getCache(cacheKey);
  if (hit != null) return hit;

  const data = await dartApiGet("/fnlttSinglAcnt.json", {
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reprtCode,
    fs_div: DART_FS_DIV,
  });
  const ok = Array.isArray(data?.list) && data.list.length > 0;
  setCache(cacheKey, ok);
  return ok;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} fn
 */
async function runPool(items, concurrency, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/** @param {string} periodId */
export function parseDartPeriodId(periodId) {
  const m = String(periodId ?? "").match(/^d:([aq]):(\d{4})(?::(\d{5}))?$/);
  if (!m) return null;
  const kind = m[1] === "a" ? "annual" : "quarter";
  const year = Number(m[2]);
  const reprtCode = m[3] ?? (kind === "annual" ? DART_REPORT_ANNUAL : "");
  if (!Number.isFinite(year) || !reprtCode) return null;
  return { kind, year, reprtCode };
}

/**
 * @param {string} symbol
 * @returns {Promise<object[]>}
 */
export async function loadDartKrFinancialPeriods(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!isDartEnabled() || !isKrQuoteSymbol(sym)) return [];

  const cacheKey = `dart:periods:v2:${sym}`;
  const hit = getCache(cacheKey);
  if (hit) return hit;

  await loadCorpIndex().catch(() => null);
  const corpCode = await resolveDartCorpCode(sym);
  if (!corpCode) return [];

  const currentYear = new Date().getFullYear();
  /** @type {object[]} */
  const periods = [];

  const annualYears = [];
  for (let y = currentYear; y >= currentYear - HISTORY_YEARS; y--) annualYears.push(y);

  await runPool(annualYears, PROBE_CONCURRENCY, async (year) => {
    if (!(await hasDartReport(corpCode, year, DART_REPORT_ANNUAL))) return;
    periods.push({
      id: `d:a:${year}`,
      label: `${year}.12`,
      kind: "annual",
      endDateMs: endMsForYearMonth(year, 12),
      isForecast: false,
      source: "dart",
    });
  });

  const quarterDefs = [
    { reprtCode: DART_REPORT_Q1, month: 3 },
    { reprtCode: DART_REPORT_HALF, month: 6 },
    { reprtCode: DART_REPORT_Q3, month: 9 },
  ];
  /** @type {{ year: number; reprtCode: string; month: number }[]} */
  const quarterJobs = [];
  for (let y = currentYear; y >= currentYear - QUARTER_HISTORY_YEARS; y--) {
    for (const q of quarterDefs) quarterJobs.push({ year: y, ...q });
  }
  await runPool(quarterJobs, PROBE_CONCURRENCY, async ({ year, reprtCode, month }) => {
    if (!(await hasDartReport(corpCode, year, reprtCode))) return;
    periods.push({
      id: `d:q:${year}:${reprtCode}`,
      label: `${year}.${String(month).padStart(2, "0")}`,
      kind: "quarter",
      endDateMs: endMsForYearMonth(year, month),
      isForecast: false,
      source: "dart",
    });
  });

  periods.sort((a, b) => (b.endDateMs ?? 0) - (a.endDateMs ?? 0));
  if (periods.length) setCache(cacheKey, periods);
  return periods;
}

/**
 * @param {string} symbol
 * @param {string} periodId
 */
export async function loadDartKrStatementDetail(symbol, periodId) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const parsed = parseDartPeriodId(periodId);
  if (!parsed) {
    const err = new Error("올바르지 않은 DART 기간 ID입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const cacheKey = `dart:detail:${sym}:${periodId}`;
  const hit = getCache(cacheKey);
  if (hit) return hit;

  const corpCode = await resolveDartCorpCode(sym);
  if (!corpCode) {
    const err = new Error("DART 고유번호를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const list = await fetchDartAccounts(corpCode, parsed.year, parsed.reprtCode);
  if (!list.length) {
    const err = new Error("DART 재무제표를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const sections = dartAccountsToSections(list).map((sec) => ({
    ...sec,
    unitNote: "단위: 억원",
  }));

  const label =
    parsed.kind === "annual"
      ? `${parsed.year}.12`
      : `${parsed.year}.${String({ [DART_REPORT_Q1]: "03", [DART_REPORT_HALF]: "06", [DART_REPORT_Q3]: "09" }[parsed.reprtCode] ?? "12")}`;

  const payload = {
    symbol: sym,
    periodId,
    label,
    kind: parsed.kind,
    isForecast: false,
    sections,
    source: "Open DART",
    updatedAt: Date.now(),
  };
  setCache(cacheKey, payload);
  return payload;
}
