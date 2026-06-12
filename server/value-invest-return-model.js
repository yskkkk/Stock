/**
 * 버핏 스타일 10년 기대수익·적정가 — 순수 계산
 */

/** @param {number} n */
export function round2(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * @param {{
 *   currentPrice: number;
 *   currentEps: number;
 *   growthRate: number;
 *   averagePer: number;
 *   payoutRatio: number;
 *   targetReturnRate: number;
 *   years?: number;
 * }} input
 */
export function calcValueInvestReturn(input) {
  const {
    currentPrice,
    currentEps,
    growthRate,
    averagePer,
    payoutRatio,
    targetReturnRate,
    years = 10,
  } = input;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (!Number.isFinite(currentEps) || currentEps <= 0) return null;
  if (!Number.isFinite(averagePer) || averagePer <= 0) return null;
  if (!Number.isFinite(targetReturnRate) || targetReturnRate < 0) return null;

  const g = Number.isFinite(growthRate) ? growthRate : 0;
  const payout = Number.isFinite(payoutRatio)
    ? Math.max(0, Math.min(1, payoutRatio))
    : 0;
  const n = Math.max(1, Math.min(30, Math.floor(years)));

  /** @type {{ year: number; eps: number }[]} */
  const yearlyEps = [];
  let eps = currentEps;
  for (let t = 1; t <= n; t++) {
    eps *= 1 + g;
    yearlyEps.push({ year: t, eps: round2(eps) ?? eps });
  }

  const totalEps = yearlyEps.reduce((sum, row) => sum + row.eps, 0);
  const epsAtEnd = yearlyEps[n - 1]?.eps ?? null;
  if (epsAtEnd == null || epsAtEnd <= 0) return null;

  const futurePrice = round2(epsAtEnd * averagePer);
  const totalDividends = round2(totalEps * payout);
  const totalReturn =
    futurePrice != null && totalDividends != null
      ? round2(futurePrice + totalDividends)
      : null;

  const cagr =
    totalReturn != null && totalReturn > 0
      ? round2((totalReturn / currentPrice) ** (1 / n) - 1)
      : null;

  const fairBuyPrice =
    totalReturn != null && totalReturn > 0
      ? round2(totalReturn / (1 + targetReturnRate) ** n)
      : null;

  return {
    years: n,
    yearlyEps,
    totalEps: round2(totalEps),
    epsAtEnd: round2(epsAtEnd),
    futurePrice,
    totalDividends,
    totalReturn,
    cagr,
    cagrPct: cagr != null ? round2(cagr * 100) : null,
    fairBuyPrice,
  };
}
