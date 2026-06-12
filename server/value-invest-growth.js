/**
 * 10년 수익 모델 — 성장률 산출 (연간 EPS 이력 CAGR)
 */

/** EPS CAGR 산출에 쓰는 최대 연수 */
export const EPS_GROWTH_HISTORY_YEARS = 10;

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [maxYears]
 * @returns {{ start: { year: number; eps: number }; end: { year: number; eps: number }; periodYears: number; fromListing: boolean } | null}
 */
export function epsGrowthWindow(series, maxYears = EPS_GROWTH_HISTORY_YEARS) {
  const sorted = (series ?? [])
    .filter((s) => s.year > 0 && s.eps > 0)
    .sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return null;

  const end = sorted[sorted.length - 1];
  const listingSpan = end.year - sorted[0].year;
  const fromListing = listingSpan < maxYears;
  const start = fromListing
    ? sorted[0]
    : (sorted.find((s) => s.year >= end.year - maxYears) ?? sorted[0]);

  const periodYears = end.year - start.year;
  if (periodYears < 1) return null;

  return { start, end, periodYears, fromListing };
}

/**
 * 연간 EPS CAGR: (EPS_최근 / EPS_과거)^(1/기간년수) − 1
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [maxYears]
 */
export function epsCagrFromHistory(series, maxYears = EPS_GROWTH_HISTORY_YEARS) {
  const window = epsGrowthWindow(series, maxYears);
  if (!window) return null;
  const ratio = window.end.eps / window.start.eps;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const cagr = ratio ** (1 / window.periodYears) - 1;
  return Number.isFinite(cagr) ? cagr : null;
}

/**
 * @param {{ year: number; eps: number }[]} series
 */
function formatEpsCagrSource(series) {
  const window = epsGrowthWindow(series);
  if (!window) return "EPS CAGR";
  const { start, end, periodYears, fromListing } = window;
  const spanNote = fromListing ? `, 상장 ${periodYears}년` : "";
  return `EPS CAGR ${start.year}→${end.year} (${periodYears}년${spanNote})`;
}

/**
 * @param {{
 *   eps: number | null;
 *   forwardEps: number | null;
 *   revenueGrowth: number | null;
 *   epsHistory?: { year: number; eps: number }[];
 * }} f
 */
export function deriveValueInvestGrowth10y(f) {
  /** @type {string[]} */
  const warnings = [];

  const histGrowth = epsCagrFromHistory(f.epsHistory ?? []);
  if (histGrowth != null && Number.isFinite(histGrowth)) {
    if (histGrowth < -0.4) {
      warnings.push(`EPS CAGR ${(histGrowth * 100).toFixed(1)}% — 음수 성장 구간`);
    }
    return {
      value: histGrowth,
      source: formatEpsCagrSource(f.epsHistory ?? []),
      warnings,
    };
  }

  const rg = f.revenueGrowth;
  if (rg != null && Number.isFinite(rg)) {
    return {
      value: rg,
      source: "Yahoo revenueGrowth",
      warnings,
    };
  }

  const eps = f.eps;
  const fwd = f.forwardEps;
  if (eps != null && eps > 0 && fwd != null && fwd > 0) {
    const implied1y = fwd / eps - 1;
    if (implied1y < -0.5) {
      warnings.push(`Forward÷Trailing ${(implied1y * 100).toFixed(0)}% — 급격한 이익 감소 구간`);
    }
    return {
      value: implied1y,
      source: "Forward EPS ÷ Trailing EPS (차기 1년 추정)",
      warnings,
    };
  }

  return { value: null, source: null, warnings };
}
