/**
 * 10년 수익 모델 — 성장률 산출 (연간 EPS 이력 CAGR, 1년 Forward÷Trailing을 10년 CAGR로 쓰지 않음)
 */

/** 10년 복리 가정 자동 상한 */
export const GROWTH_10Y_CAP = 0.25;

/** EPS CAGR 산출에 쓰는 최대 연수 */
export const EPS_GROWTH_HISTORY_YEARS = 10;

/**
 * @param {{ year: number; eps: number }[]} series
 * @param {number} [maxYears]
 * @returns {{ start: { year: number; eps: number }; end: { year: number; eps: number }; periodYears: number } | null}
 */
export function epsGrowthWindow(series, maxYears = EPS_GROWTH_HISTORY_YEARS) {
  const sorted = (series ?? [])
    .filter((s) => s.year > 0 && s.eps > 0)
    .sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return null;
  const recent = sorted.slice(-maxYears);
  const start = recent[0];
  const end = recent[recent.length - 1];
  const periodYears = end.year - start.year;
  if (periodYears < 1) return null;
  return { start, end, periodYears };
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
function formatEpsCagrSource(series, rawGrowth, cappedGrowth) {
  const window = epsGrowthWindow(series);
  if (!window) return "EPS CAGR";
  const { start, end, periodYears } = window;
  const base = `EPS CAGR ${start.year}→${end.year} (${periodYears}년)`;
  if (rawGrowth != null && cappedGrowth != null && rawGrowth > GROWTH_10Y_CAP) {
    return `${base} → 10년 상한 ${GROWTH_10Y_CAP * 100}%`;
  }
  return base;
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
    if (histGrowth > GROWTH_10Y_CAP) {
      warnings.push(
        `EPS CAGR ${(histGrowth * 100).toFixed(1)}% — 10년 복리 가정은 ${GROWTH_10Y_CAP * 100}%로 상한`,
      );
      return {
        value: GROWTH_10Y_CAP,
        source: formatEpsCagrSource(f.epsHistory ?? [], histGrowth, GROWTH_10Y_CAP),
        warnings,
      };
    }
    if (histGrowth < -0.4) {
      warnings.push(`EPS CAGR ${(histGrowth * 100).toFixed(1)}% — 음수 성장 구간`);
    }
    return {
      value: histGrowth,
      source: formatEpsCagrSource(f.epsHistory ?? [], histGrowth, histGrowth),
      warnings,
    };
  }

  const rg = f.revenueGrowth;
  if (rg != null && Number.isFinite(rg)) {
    const capped = Math.min(rg, GROWTH_10Y_CAP);
    if (rg > GROWTH_10Y_CAP) {
      warnings.push(`매출 성장률 ${(rg * 100).toFixed(1)}% — 10년 상한 ${GROWTH_10Y_CAP * 100}% 적용`);
    }
    return {
      value: capped,
      source: "Yahoo revenueGrowth",
      warnings,
    };
  }

  const eps = f.eps;
  const fwd = f.forwardEps;
  if (eps != null && eps > 0 && fwd != null && fwd > 0) {
    const implied1y = fwd / eps - 1;
    if (implied1y > GROWTH_10Y_CAP) {
      warnings.push(
        `Forward EPS(${fwd.toLocaleString()})는 차기 1년 컨센서스, Trailing EPS(${eps.toLocaleString()}) 대비 +${(implied1y * 100).toFixed(0)}%입니다. 이 비율을 10년 매년 복리로 쓰면 비현실적이므로 10년 성장률은 ${GROWTH_10Y_CAP * 100}% 상한을 적용했습니다.`,
      );
      return {
        value: GROWTH_10Y_CAP,
        source: `Forward÷Trailing +${(implied1y * 100).toFixed(0)}% (1년) → 10년 상한 ${GROWTH_10Y_CAP * 100}%`,
        warnings,
      };
    }
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
