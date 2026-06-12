/**
 * 10년 수익 모델 — 연간 EPS 이력 (성장률 CAGR용, 아카이브 우선)
 */
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";

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
    .slice(-6);

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
