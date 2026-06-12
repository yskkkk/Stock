/**
 * 10년 수익 모델 — 연간 EPS 이력 (평균 EPS·성장률 CAGR용)
 */
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";
import { buildHistoricalPeriodMetrics } from "./stock-financial-period-valuation.js";
import { parseStatementNumber } from "./stock-financials-analysis.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

/** 기준 EPS 산출에 쓰는 최대 연수 (상장 10년 미만이면 가용 연수만) */
export const EPS_AVERAGE_MAX_YEARS = 10;

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [maxYears]
 * @returns {{ avg: number | null; years: { year: number; eps: number }[]; source: string | null }}
 */
export function averageEpsFromHistory(series, maxYears = EPS_AVERAGE_MAX_YEARS) {
  const positive = (series ?? [])
    .filter((s) => s.year > 0 && s.eps > 0)
    .sort((a, b) => a.year - b.year);
  if (positive.length === 0) {
    return { avg: null, years: [], source: null };
  }
  const recent = positive.slice(-maxYears);
  const avg = recent.reduce((sum, row) => sum + row.eps, 0) / recent.length;
  if (!Number.isFinite(avg) || avg <= 0) {
    return { avg: null, years: [], source: null };
  }
  const start = recent[0].year;
  const end = recent[recent.length - 1].year;
  const span =
    recent.length < maxYears
      ? `연간 EPS ${start}–${end} 평균 (${recent.length}개 실적, 상장 ${maxYears}년 미만)`
      : `연간 EPS ${start}–${end} 평균 (${recent.length}개 실적)`;
  return { avg, years: recent, source: span };
}

/**
 * @param {string} symbol
 * @returns {Promise<{ year: number; eps: number }[]>}
 */
export async function loadAnnualEpsHistory(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const periods = await loadFinancialPeriods(sym).catch(() => null);
  if (!periods?.periods?.length) return [];

  /** 연도별 중복 제거: 같은 연도면 네이버 실적(n:a: 접두사)을 우선 */
  /** @type {Map<number, import("./stock-financials.js").FinancialPeriodRow>} */
  const byYear = new Map();
  for (const p of periods.periods) {
    if (p.kind !== "annual" || p.isForecast) continue;
    const y = Number(String(p.label ?? "").slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const existing = byYear.get(y);
    if (!existing || String(p.id).startsWith("n:a:")) {
      byYear.set(y, p);
    }
  }

  const annual = [...byYear.values()].sort(
    (a, b) => (a.endDateMs ?? 0) - (b.endDateMs ?? 0),
  );

  const shares =
    periods.market === "us" ? await fetchSharesOutstanding(sym) : null;

  const details = await Promise.all(
    annual.map((p) => loadFinancialStatementDetail(sym, p.id).catch(() => null)),
  );

  /** @type {{ year: number; eps: number }[]} */
  const series = [];
  for (let i = 0; i < details.length; i++) {
    const detail = details[i];
    const p = annual[i];
    if (!detail || !p) continue;
    let m = extractPeriodMetricsFromDetail(detail, {
      currency: periods.currency,
      market: periods.market,
    });
    if (
      periods.market === "us" &&
      shares != null &&
      shares > 0
    ) {
      const fromNi = epsFromNetIncomeAndShares(detail, shares);
      if (fromNi != null) {
        m = { ...m, eps: fromNi };
      }
    } else if (periods.market === "us" && (m.eps == null || m.eps <= 0)) {
      m = await buildHistoricalPeriodMetrics(sym, p, m, detail);
    }
    if (m.eps == null || m.eps <= 0) continue;
    const y = Number(String(p.label ?? "").slice(0, 4));
    series.push({ year: Number.isFinite(y) ? y : 0, eps: m.eps });
  }
  return series.filter((s) => s.year > 0).sort((a, b) => a.year - b.year);
}

/** @param {unknown} v */
function numField(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

/**
 * @param {string} symbol
 * @returns {Promise<number | null>}
 */
async function fetchSharesOutstanding(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  try {
    const data = await queueYahooRequest(() =>
      yahooGet(
        `/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=defaultKeyStatistics`,
      ),
    );
    const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    const shares =
      numField(stats?.sharesOutstanding) ??
      numField(stats?.impliedSharesOutstanding);
    return shares != null && shares > 0 ? shares : null;
  } catch {
    return null;
  }
}

/**
 * @param {Awaited<ReturnType<typeof loadFinancialStatementDetail>>} detail
 * @param {number} shares
 */
function epsFromNetIncomeAndShares(detail, shares) {
  if (!detail?.sections?.length || shares <= 0) return null;
  for (const sec of detail.sections) {
    for (const row of sec.rows ?? []) {
      const n = String(row.label ?? "")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!n.includes("netincome") && !n.includes("당기순이익")) continue;
      const netIncome = parseStatementNumber(row.value, sec.unitNote ?? "");
      if (netIncome == null || netIncome <= 0) return null;
      return netIncome / shares;
    }
  }
  return null;
}
