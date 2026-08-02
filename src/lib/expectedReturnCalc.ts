/** 예상 투자 수익률(PER·성장·배당) — 피터 린치형 10년 표 로직 */

export type ExpectedReturnCalcInput = {
  /** 현재 주가 */
  currentPrice: number;
  /** 기준 EPS (성장 적용 전) */
  currentEps: number;
  /** 연 이익 성장률 (%) — 예: 15.2 */
  earningsGrowthPct: number;
  /** 목표·평균 PER */
  avgPer: number;
  /** 배당성향 (%) — 예: 25 */
  dividendPayoutPct: number;
  /** 투자기간(년) */
  years: number;
  /** 목표 연수익률 (%) — 매수가 상한 계산용 */
  targetReturnPct: number;
};

export type ExpectedReturnYearRow = {
  year: number;
  eps: number;
};

export type ExpectedReturnCalcResult = {
  years: ExpectedReturnYearRow[];
  /** Σ year1..N EPS */
  totalEps: number;
  /** 최종연 EPS × PER */
  futurePrice: number;
  /** 총 이익 × 배당성향 */
  totalDividends: number;
  /** 미래주가 + 총배당 */
  totalProceeds: number;
  /** 현재가 기준 연평균 수익률 (소수, 예: 0.082) */
  expectedCagr: number | null;
  /** 목표 수익률을 맞추는 최대 매수가 */
  maxBuyPrice: number | null;
};

function finitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * Year k EPS = currentEps × (1+g)^k  (k = 1..years)
 * 예: EPS 3.33, g 15.2% → Y1 3.84 … Y10 13.71
 */
export function computeExpectedReturnCalc(
  input: ExpectedReturnCalcInput,
): ExpectedReturnCalcResult | null {
  const {
    currentPrice,
    currentEps,
    earningsGrowthPct,
    avgPer,
    dividendPayoutPct,
    years,
    targetReturnPct,
  } = input;

  const y = Math.floor(years);
  if (
    !finitePositive(currentPrice) ||
    !finitePositive(currentEps) ||
    !Number.isFinite(earningsGrowthPct) ||
    !finitePositive(avgPer) ||
    !Number.isFinite(dividendPayoutPct) ||
    dividendPayoutPct < 0 ||
    !Number.isFinite(y) ||
    y < 1 ||
    y > 50 ||
    !Number.isFinite(targetReturnPct)
  ) {
    return null;
  }

  const g = 1 + earningsGrowthPct / 100;
  const payout = dividendPayoutPct / 100;
  const rows: ExpectedReturnYearRow[] = [];
  let totalEps = 0;
  let eps = currentEps;
  for (let i = 1; i <= y; i += 1) {
    eps *= g;
    rows.push({ year: i, eps });
    totalEps += eps;
  }

  const finalEps = rows[rows.length - 1]!.eps;
  const futurePrice = finalEps * avgPer;
  const totalDividends = totalEps * payout;
  const totalProceeds = futurePrice + totalDividends;

  const expectedCagr =
    currentPrice > 0 && totalProceeds > 0
      ? Math.pow(totalProceeds / currentPrice, 1 / y) - 1
      : null;

  const targetFactor = 1 + targetReturnPct / 100;
  const maxBuyPrice =
    targetFactor > 0 && Number.isFinite(targetFactor)
      ? totalProceeds / Math.pow(targetFactor, y)
      : null;

  return {
    years: rows,
    totalEps,
    futurePrice,
    totalDividends,
    totalProceeds,
    expectedCagr,
    maxBuyPrice,
  };
}
