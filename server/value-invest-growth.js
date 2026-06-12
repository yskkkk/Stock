/**
 * 10년 수익 모델 — 성장률 산출 (1년 Forward÷Trailing을 10년 CAGR로 쓰지 않음)
 */

/** 10년 복리 가정 자동 상한 */
export const GROWTH_10Y_CAP = 0.25;

/**
 * 전년 대비 EPS 이익성장률: (당기 EPS - 전기 EPS) / |전기 EPS|
 * @param {{ year: number; eps: number }[]} series
 */
export function epsCagrFromHistory(series) {
  const sorted = (series ?? []).filter((s) => s.eps > 0).sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return null;
  const prev = sorted[sorted.length - 2];
  const curr = sorted[sorted.length - 1];
  if (prev.eps <= 0) return null;
  const growth = (curr.eps - prev.eps) / prev.eps;
  return Number.isFinite(growth) ? growth : null;
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
    const sorted = (f.epsHistory ?? []).filter((s) => s.eps > 0).sort((a, b) => a.year - b.year);
    const prevYear = sorted.length >= 2 ? sorted[sorted.length - 2].year : null;
    const currYear = sorted.length >= 1 ? sorted[sorted.length - 1].year : null;
    if (histGrowth > GROWTH_10Y_CAP) {
      warnings.push(
        `전년 대비 EPS 성장률 ${(histGrowth * 100).toFixed(1)}% — 10년 복리 가정은 ${GROWTH_10Y_CAP * 100}%로 상한`,
      );
      return {
        value: GROWTH_10Y_CAP,
        source: `전년 대비 EPS 성장률 ${(histGrowth * 100).toFixed(1)}% → 10년 상한 ${GROWTH_10Y_CAP * 100}%`,
        warnings,
      };
    }
    if (histGrowth < -0.4) {
      warnings.push(`전년 대비 EPS 성장률 ${(histGrowth * 100).toFixed(1)}% — 음수 성장 구간`);
    }
    return {
      value: histGrowth,
      source: prevYear && currYear
        ? `전년 대비 EPS 성장률 ${prevYear}→${currYear}`
        : `전년 대비 EPS 성장률 (${f.epsHistory.length}개 실적)`,
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
