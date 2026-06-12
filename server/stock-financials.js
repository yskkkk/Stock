/**
 * 재무제표 기간 목록·상세 — KR: DART + Naver finance, US: Yahoo quoteSummary history
 */
import { isKrQuoteSymbol, yahooSymbolToKrCode } from "./kr-naver-quote.js";
import { isDartEnabled } from "./dart.js";
import { loadDartKrFinancialPeriods, loadDartKrStatementDetail } from "./dart-financials.js";
import { resolveDisplayName } from "./names-ko.js";
import { normalizeKrStatementMoneyValue } from "./statement-display-units.js";
import {
  isLiveFinancialsFetchForced,
  readArchivedFinancialPeriods,
  readArchivedStatementDetail,
} from "./stock-financials-archive-store.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

const CACHE_MS = 5 * 60_000;
const NAVER_FINANCE_URL = "https://m.stock.naver.com/api/stock";
const NAVER_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

/** @type {Map<string, { at: number; data: unknown }>} */
const cache = new Map();

/** @param {string} key @param {unknown} data */
function setCache(key, data) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/** @param {string} key */
function getCache(key) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.data;
}

/** @param {unknown} v */
function numField(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown; fmt?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const fmt = /** @type {{ fmt?: unknown }} */ (v).fmt;
    if (typeof fmt === "string" && fmt.trim()) return fmt.trim();
  }
  return null;
}

/** @param {unknown} v */
function displayField(v) {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v === 0 ? "—" : String(v);
  }
  if (typeof v === "object") {
    const o = /** @type {{ fmt?: unknown; longFmt?: unknown; raw?: unknown }} */ (v);
    if (typeof o.raw === "number" && Number.isFinite(o.raw) && o.raw === 0 && o.fmt == null) {
      return "—";
    }
    if (typeof o.longFmt === "string" && o.longFmt.trim()) return o.longFmt.trim();
    if (typeof o.fmt === "string" && o.fmt.trim()) return o.fmt.trim();
    if (typeof o.raw === "number" && Number.isFinite(o.raw)) return String(o.raw);
  }
  return "—";
}

/** @param {string} key YYYYMM */
function naverKeyToEndMs(key) {
  const m = String(key ?? "").match(/^(\d{4})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return Date.UTC(y, mo, 0, 12, 0, 0);
}

/** @param {string} code @param {"annual"|"quarter"} type */
async function fetchNaverFinanceSheet(code, type) {
  const url = `${NAVER_FINANCE_URL}/${code}/finance/${type}`;
  const res = await fetch(url, {
    headers: { "User-Agent": NAVER_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  return res.json();
}

/** @param {unknown} body @param {"annual"|"quarter"} kind */
function naverPeriodsFromBody(body, kind) {
  const info = body?.financeInfo;
  const titles = Array.isArray(info?.trTitleList) ? info.trTitleList : [];
  /** @type {object[]} */
  const out = [];
  for (const t of titles) {
    const key = String(t?.key ?? "").trim();
    const label = String(t?.title ?? key).trim();
    if (!key) continue;
    out.push({
      id: `n:${kind === "annual" ? "a" : "q"}:${key}`,
      label: label.replace(/\.$/, ""),
      kind,
      endDateMs: naverKeyToEndMs(key),
      isForecast: String(t?.isConsensus ?? "") === "Y",
      source: "naver",
    });
  }
  return out;
}

/** @param {unknown} body @param {string} periodKey */
function naverDetailFromBody(body, periodKey) {
  const info = body?.financeInfo;
  const rows = Array.isArray(info?.rowList) ? info.rowList : [];
  /** @type {{ label: string; value: string }[]} */
  const lineRows = [];
  for (const row of rows) {
    const label = String(row?.title ?? "").trim();
    if (!label) continue;
    const cols = row?.columns;
    const cell =
      cols && typeof cols === "object"
        ? /** @type {Record<string, { value?: string }>} */ (cols)[periodKey]
        : null;
    const value = cell?.value != null ? String(cell.value).trim() : "—";
    lineRows.push({ label, value: value || "—" });
  }
  return [
    {
      title: "재무제표",
      unitNote: "단위: 억원",
      rows: lineRows,
    },
  ];
}

const YAHOO_INCOME_LABELS = {
  totalRevenue: "매출액",
  costOfRevenue: "매출원가",
  grossProfit: "매출총이익",
  operatingIncome: "영업이익",
  netIncome: "당기순이익",
  ebit: "EBIT",
  incomeBeforeTax: "법인세차감전이익",
  incomeTaxExpense: "법인세",
  researchDevelopment: "연구개발비",
  sellingGeneralAdministrative: "판매·관리비",
};

const YAHOO_BALANCE_LABELS = {
  totalAssets: "총자산",
  totalLiab: "총부채",
  totalStockholderEquity: "총자본",
  cash: "현금",
  netReceivables: "매출채권",
  inventory: "재고자산",
  longTermDebt: "장기부채",
  shortLongTermDebt: "단기차입금",
};

const YAHOO_CASH_LABELS = {
  totalCashFromOperatingActivities: "영업활동현금흐름",
  totalCashFromInvestingActivities: "투자활동현금흐름",
  totalCashFromFinancingActivities: "재무활동현금흐름",
  capitalExpenditures: "CAPEX",
  dividendsPaid: "배당금",
  freeCashFlow: "잉여현금흐름",
};

/** @param {Record<string, unknown>} stmt @param {Record<string, string>} labels @param {{ market?: "kr"|"us" }} [opts] */
function yahooRowsFromStatement(stmt, labels, opts = {}) {
  const market = opts.market ?? "us";
  /** @type {{ label: string; value: string }[]} */
  const rows = [];
  for (const [field, label] of Object.entries(labels)) {
    if (!(field in stmt)) continue;
    let value = displayField(stmt[field]);
    if (value === "—") continue;
    if (market === "kr") {
      value = normalizeKrStatementMoneyValue(value, "단위: 억원", label);
    }
    rows.push({ label, value });
  }
  return rows;
}

/** @param {unknown} data */
function yahooQuoteResult(data) {
  const qs = data?.quoteSummary;
  if (!qs || typeof qs !== "object") return null;
  const results = /** @type {unknown[]} */ (qs.result);
  if (!Array.isArray(results) || !results[0]) return null;
  return /** @type {Record<string, unknown>} */ (results[0]);
}

/** @param {Record<string, unknown>} r0 */
function yahooHistoryBundle(r0) {
  return {
    incomeAnnual:
      /** @type {unknown[]} */ (
        r0.incomeStatementHistory?.incomeStatementHistory
      ) ?? [],
    incomeQuarter:
      /** @type {unknown[]} */ (
        r0.incomeStatementHistoryQuarterly?.incomeStatementHistory
      ) ?? [],
    balanceAnnual:
      /** @type {unknown[]} */ (r0.balanceSheetHistory?.balanceSheetHistory) ??
      [],
    balanceQuarter:
      /** @type {unknown[]} */ (
        r0.balanceSheetHistoryQuarterly?.balanceSheetHistory
      ) ?? [],
    cashAnnual:
      /** @type {unknown[]} */ (
        r0.cashflowStatementHistory?.cashflowStatementHistory
      ) ?? [],
    cashQuarter:
      /** @type {unknown[]} */ (
        r0.cashflowStatementHistoryQuarterly?.cashflowStatementHistory
      ) ?? [],
  };
}

/** @param {unknown[]} arr @param {"annual"|"quarter"} kind @param {Map<string, object>} periods */
function addYahooPeriodsFrom(arr, kind, periods) {
  for (const stmt of arr) {
    if (!stmt || typeof stmt !== "object") continue;
    const endRaw = /** @type {{ endDate?: { raw?: number } }} */ (stmt).endDate?.raw;
    if (typeof endRaw !== "number" || !Number.isFinite(endRaw)) continue;
    const endDateMs = endRaw * 1000;
    const id = `y:${kind === "annual" ? "a" : "q"}:${endRaw}`;
    if (periods.has(id)) continue;
    const d = new Date(endDateMs);
    const label =
      kind === "annual"
        ? `${d.getUTCFullYear()}`
        : `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    periods.set(id, {
      id,
      label,
      kind,
      endDateMs,
      isForecast: false,
      source: "yahoo",
    });
  }
}

/** @param {string} symbol */
async function loadYahooFinancialBundle(symbol) {
  const cacheKey = `yahoo:bundle:${symbol}`;
  const hit = getCache(cacheKey);
  if (hit) return hit;

  const modules = [
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
    "balanceSheetHistory",
    "balanceSheetHistoryQuarterly",
    "cashflowStatementHistory",
    "cashflowStatementHistoryQuarterly",
    "price",
  ].join(",");
  const data = await queueYahooRequest(() =>
    yahooGet(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`),
  );
  const r0 = yahooQuoteResult(data);
  if (!r0) {
    const err = new Error("재무제표 데이터를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }
  const bundle = yahooHistoryBundle(r0);
  const name =
    (typeof r0.price === "object" &&
      typeof /** @type {{ longName?: string }} */ (r0.price).longName === "string" &&
      /** @type {{ longName?: string }} */ (r0.price).longName.trim()) ||
    resolveDisplayName(symbol);
  const payload = { bundle, name };
  setCache(cacheKey, payload);
  return payload;
}

/**
 * @param {string} symbol
 * @param {{ forceLive?: boolean }} [options]
 */
export async function loadFinancialPeriods(symbol, options = {}) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,20}$/.test(sym)) {
    const err = new Error("올바르지 않은 심볼 형식입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const forceLive = options.forceLive === true || isLiveFinancialsFetchForced();
  if (!forceLive) {
    const archived = readArchivedFinancialPeriods(sym);
    if (archived) return archived;
  }

  const cacheKey = `periods:v2:${sym}`;
  const hit = forceLive ? null : getCache(cacheKey);
  if (hit) return hit;

  /** @type {Map<string, object>} */
  const periodMap = new Map();
  let name = resolveDisplayName(sym);
  let market = isKrQuoteSymbol(sym) ? "kr" : "us";
  let currency = market === "kr" ? "KRW" : "USD";

  if (isKrQuoteSymbol(sym)) {
    if (isDartEnabled()) {
      try {
        for (const p of await loadDartKrFinancialPeriods(sym)) periodMap.set(p.id, p);
      } catch {
        /* DART 보조 — Naver만 있어도 OK */
      }
    }
    const code = yahooSymbolToKrCode(sym);
    if (code) {
      const [annual, quarter] = await Promise.all([
        fetchNaverFinanceSheet(code, "annual"),
        fetchNaverFinanceSheet(code, "quarter"),
      ]);
      for (const p of naverPeriodsFromBody(annual, "annual")) periodMap.set(p.id, p);
      for (const p of naverPeriodsFromBody(quarter, "quarter")) periodMap.set(p.id, p);
      if (typeof annual?.financeInfo?.itemCode === "string") {
        name = resolveDisplayName(sym, name);
      }
    }
  }

  try {
    const { bundle, name: yName } = await loadYahooFinancialBundle(sym);
    if (yName) name = yName;
    addYahooPeriodsFrom(bundle.incomeAnnual, "annual", periodMap);
    addYahooPeriodsFrom(bundle.incomeQuarter, "quarter", periodMap);
  } catch {
    /* Yahoo 보조 — Naver만 있어도 OK */
  }

  const periods = [...periodMap.values()]
    .sort((a, b) => (b.endDateMs ?? 0) - (a.endDateMs ?? 0));

  /** @type {Map<string, object>} */
  const deduped = new Map();
  for (const p of periods) {
    const year = Number(String(p.label ?? "").slice(0, 4));
    const monthMatch = String(p.label ?? "").match(/\.(\d{2})$/);
    const month = monthMatch ? Number(monthMatch[1]) : p.kind === "annual" ? 12 : 0;
    const key =
      market === "kr" && Number.isFinite(year) && year > 1900
        ? `${p.kind}:${year}:${month}:${p.isForecast ? "f" : "a"}`
        : `${p.kind}:${p.label}:${p.isForecast ? "f" : "a"}`;
    const prev = deduped.get(key);
    if (!prev) {
      deduped.set(key, p);
      continue;
    }
    const rank = (src) => (src === "naver" ? 3 : src === "dart" ? 2 : 1);
    if (rank(p.source) > rank(prev.source)) deduped.set(key, p);
  }
  const uniquePeriods = [...deduped.values()].sort(
    (a, b) => (b.endDateMs ?? 0) - (a.endDateMs ?? 0),
  );

  if (uniquePeriods.length === 0) {
    const err = new Error("재무제표 기간을 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const payload = {
    symbol: sym,
    name,
    market,
    currency,
    periods: uniquePeriods,
    updatedAt: Date.now(),
  };
  setCache(cacheKey, payload);
  return payload;
}

/** @param {unknown[]} arr @param {number} endRaw */
function findYahooStmt(arr, endRaw) {
  return arr.find(
    (s) =>
      s &&
      typeof s === "object" &&
      /** @type {{ endDate?: { raw?: number } }} */ (s).endDate?.raw === endRaw,
  );
}

/**
 * @param {string} symbol
 * @param {string} periodId
 * @param {{ forceLive?: boolean }} [options]
 */
export async function loadFinancialStatementDetail(symbol, periodId, options = {}) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const pid = String(periodId ?? "").trim();
  if (!pid) {
    const err = new Error("기간 ID가 필요합니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const forceLive = options.forceLive === true || isLiveFinancialsFetchForced();
  if (!forceLive) {
    const archived = readArchivedStatementDetail(sym, pid);
    if (archived) return archived;
  }

  const cacheKey = `detail:v2:${sym}:${pid}`;
  const hit = forceLive ? null : getCache(cacheKey);
  if (hit) return hit;

  const m = pid.match(/^([dny]):([aq]):(.+)$/);
  if (!m) {
    const err = new Error("올바르지 않은 기간 ID입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const [, source, kindCode, rawKey] = m;
  const kind = kindCode === "a" ? "annual" : "quarter";

  if (source === "d") {
    return loadDartKrStatementDetail(sym, pid);
  }

  if (source === "n") {
    const code = yahooSymbolToKrCode(sym);
    if (!code) {
      const err = new Error("국내 종목 코드를 확인할 수 없습니다.");
      err.code = "NOT_FOUND";
      throw err;
    }
    const body = await fetchNaverFinanceSheet(code, kind === "annual" ? "annual" : "quarter");
    if (!body) {
      const err = new Error("재무제표를 불러오지 못했습니다.");
      err.code = "NOT_FOUND";
      throw err;
    }
    const sections = naverDetailFromBody(body, rawKey);
    const titles = body?.financeInfo?.trTitleList ?? [];
    const titleHit = titles.find((t) => String(t?.key ?? "") === rawKey);
    const payload = {
      symbol: sym,
      periodId: pid,
      label: String(titleHit?.title ?? rawKey).replace(/\.$/, ""),
      kind,
      isForecast: String(titleHit?.isConsensus ?? "") === "Y",
      sections,
      source: "Naver Finance",
      updatedAt: Date.now(),
    };
    setCache(cacheKey, payload);
    return payload;
  }

  const endRaw = Number(rawKey);
  if (!Number.isFinite(endRaw)) {
    const err = new Error("올바르지 않은 기간 ID입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const { bundle } = await loadYahooFinancialBundle(sym);
  const income = findYahooStmt(
    kind === "annual" ? bundle.incomeAnnual : bundle.incomeQuarter,
    endRaw,
  );
  const balance = findYahooStmt(
    kind === "annual" ? bundle.balanceAnnual : bundle.balanceQuarter,
    endRaw,
  );
  const cash = findYahooStmt(
    kind === "annual" ? bundle.cashAnnual : bundle.cashQuarter,
    endRaw,
  );

  if (!income && !balance && !cash) {
    const err = new Error("해당 기간 재무제표를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const endDateMs = endRaw * 1000;
  const d = new Date(endDateMs);
  const label =
    kind === "annual"
      ? `${d.getUTCFullYear()}`
      : `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  /** @type {object[]} */
  const sections = [];
  const yahooMarket = isKrQuoteSymbol(sym) ? "kr" : "us";
  const yahooUnitNote = yahooMarket === "kr" ? "단위: 억원" : "단위: USD (millions)";
  if (income && typeof income === "object") {
    sections.push({
      title: "손익계산서",
      unitNote: yahooUnitNote,
      rows: yahooRowsFromStatement(
        /** @type {Record<string, unknown>} */ (income),
        YAHOO_INCOME_LABELS,
        { market: yahooMarket },
      ),
    });
  }
  if (balance && typeof balance === "object") {
    sections.push({
      title: "재무상태표",
      unitNote: yahooUnitNote,
      rows: yahooRowsFromStatement(
        /** @type {Record<string, unknown>} */ (balance),
        YAHOO_BALANCE_LABELS,
        { market: yahooMarket },
      ),
    });
  }
  if (cash && typeof cash === "object") {
    sections.push({
      title: "현금흐름표",
      unitNote: yahooUnitNote,
      rows: yahooRowsFromStatement(
        /** @type {Record<string, unknown>} */ (cash),
        YAHOO_CASH_LABELS,
        { market: yahooMarket },
      ),
    });
  }

  const payload = {
    symbol: sym,
    periodId: pid,
    label,
    kind,
    isForecast: false,
    sections,
    source: "Yahoo Finance",
    updatedAt: Date.now(),
  };
  setCache(cacheKey, payload);
  return payload;
}
