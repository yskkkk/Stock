export function round2(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export interface ValueInvestReturnInput {
  currentPrice: number;
  currentEps: number;
  growthRate: number;
  averagePer: number;
  payoutRatio: number;
  targetReturnRate: number;
  years?: number;
}

export interface ValueInvestReturnYearRow {
  year: number;
  eps: number;
}

export interface ValueInvestReturnResult {
  years: number;
  yearlyEps: ValueInvestReturnYearRow[];
  totalEps: number | null;
  epsAtEnd: number | null;
  futurePrice: number | null;
  totalDividends: number | null;
  totalReturn: number | null;
  cagr: number | null;
  cagrPct: number | null;
  fairBuyPrice: number | null;
}

export function calcValueInvestReturn(
  input: ValueInvestReturnInput,
): ValueInvestReturnResult | null {
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

  const yearlyEps: ValueInvestReturnYearRow[] = [];
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

export type ValueInvestFormulaLine = { label: string; formula: string };

export function buildValueInvestFormulaLines(
  input: ValueInvestReturnInput,
  result: ValueInvestReturnResult,
  labels: {
    epsAtEnd: string;
    totalEps: string;
    futurePrice: string;
    dividends: string;
    totalReturn: string;
    cagr: string;
    fairPrice: string;
  },
): ValueInvestFormulaLine[] {
  const n = result.years;
  const gPct = round2(input.growthRate * 100);
  const tgtPct = round2(input.targetReturnRate * 100);

  return [
    {
      label: labels.epsAtEnd,
      formula: `${input.currentEps} × (1 + ${gPct}%)^${n} ≈ ${result.epsAtEnd ?? "—"}`,
    },
    {
      label: labels.totalEps,
      formula: `Σ ${n}년 EPS ≈ ${result.totalEps ?? "—"}`,
    },
    {
      label: labels.futurePrice,
      formula: `${result.epsAtEnd ?? "—"} × ${input.averagePer} ≈ ${result.futurePrice ?? "—"}`,
    },
    {
      label: labels.dividends,
      formula: `${result.totalEps ?? "—"} × ${round2(input.payoutRatio * 100)}% ≈ ${result.totalDividends ?? "—"}`,
    },
    {
      label: labels.totalReturn,
      formula: `${result.futurePrice ?? "—"} + ${result.totalDividends ?? "—"} ≈ ${result.totalReturn ?? "—"}`,
    },
    {
      label: labels.cagr,
      formula: `(${result.totalReturn ?? "—"} ÷ ${input.currentPrice})^(1/${n}) − 1 ≈ ${result.cagrPct ?? "—"}%`,
    },
    {
      label: labels.fairPrice,
      formula: `${result.totalReturn ?? "—"} ÷ (1 + ${tgtPct}%)^${n} ≈ ${result.fairBuyPrice ?? "—"}`,
    },
  ];
}
