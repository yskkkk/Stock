/**
 * 10년 수익 모델 — 연간 EPS 이력 (평균 EPS·성장률 CAGR용)
 */
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";

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

  const annual = periods.periods
    .filter((p) => p.kind === "annual" && !p.isForecast)
    .sort((a, b) => (a.endDateMs ?? 0) - (b.endDateMs ?? 0))
    .slice(-(EPS_AVERAGE_MAX_YEARS + 2));

  /** @type {{ year: number; eps: number }[]} */
  const series = [];
  for (const p of annual) {
    const detail = await loadFinancialStatementDetail(sym, p.id).catch(() => null);
    if (!detail) continue;
    const m = extractPeriodMetricsFromDetail(detail, {
      currency: periods.currency,
      market: periods.market,
    });
    if (m.eps == null || m.eps <= 0) continue;
    const y = Number(String(p.label ?? "").slice(0, 4));
    series.push({ year: Number.isFinite(y) ? y : 0, eps: m.eps });
  }
  return series.filter((s) => s.year > 0).sort((a, b) => a.year - b.year);
}
