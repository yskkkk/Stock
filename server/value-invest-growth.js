/**
 * 10년 수익 모델 — 성장률 산출 (1년 Forward÷Trailing을 10년 CAGR로 쓰지 않음)
 */

/** 10년 복리 가정 자동 상한 */
export const GROWTH_10Y_CAP = 0.25;

/**
 * @param {{ year: number; eps: number }[]} series
 */
export function epsCagrFromHistory(series) {
  const positive = (series ?? []).filter((s) => s.eps > 0).sort((a, b) => a.year - b.year);
  if (positive.length < 3) return null;
  const first = positive[0];
  const last = positive[positive.length - 1];
  const span = last.year - first.year;
  if (span < 2 || first.eps <= 0 || last.eps <= 0) return null;
  const cagr = (last.eps / first.eps) ** (1 / span) - 1;
  return Number.isFinite(cagr) ? cagr : null;
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

  const histCagr = epsCagrFromHistory(f.epsHistory ?? []);
  if (histCagr != null && Number.isFinite(histCagr)) {
    if (histCagr > GROWTH_10Y_CAP) {
      warnings.push(
        `연간 EPS CAGR ${(histCagr * 100).toFixed(1)}% — 10년 복리 가정은 ${GROWTH_10Y_CAP * 100}%로 상한`,
      );
      return {
        value: GROWTH_10Y_CAP,
        source: `연간 EPS CAGR ${(histCagr * 100).toFixed(1)}% → 10년 상한 ${GROWTH_10Y_CAP * 100}%`,
        warnings,
      };
    }
    if (histCagr < -0.4) {
      warnings.push(`연간 EPS CAGR ${(histCagr * 100).toFixed(1)}% — 음수 성장 구간`);
    }
    return {
      value: histCagr,
      source: `연간 EPS 이력 CAGR (${f.epsHistory.length}개 실적)`,
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
