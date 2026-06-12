/**
 * 가치투자 10년 수익 모델 — 실제 시장·재무 데이터 조립
 */
import { calcValueInvestReturn } from "./value-invest-return-model.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import { deriveValueInvestGrowth10y } from "./value-invest-growth.js";
import {
  averageEpsFromHistory,
  loadAnnualEpsHistory,
} from "./value-invest-eps-history.js";

const DEFAULT_TARGET_RETURN = 0.15;
const DEFAULT_YEARS = 10;

/**
 * @param {Awaited<ReturnType<typeof loadStockFundamentals>>} f
 * @param {{ targetReturnRate?: number; years?: number; epsHistory?: { year: number; eps: number }[] }} opts
 */
export function buildValueInvestInputsFromFundamentals(f, opts = {}) {
  const targetReturnRate = opts.targetReturnRate ?? DEFAULT_TARGET_RETURN;
  const years = opts.years ?? DEFAULT_YEARS;
  const missing = [];
  const sources = {};

  const currentPrice = f.price;
  const epsHistory = opts.epsHistory ?? [];
  const epsAverage = averageEpsFromHistory(epsHistory);
  const trailingEps = f.eps;
  const currentEps = epsAverage.avg ?? trailingEps;
  if (currentPrice == null || currentPrice <= 0) {
    missing.push("현재가");
  } else {
    sources.currentPrice = f.source;
  }
  if (currentEps == null || currentEps <= 0) {
    missing.push("EPS");
  } else if (epsAverage.avg != null && epsAverage.source) {
    sources.currentEps = epsAverage.source;
  } else {
    sources.currentEps = f.source;
  }

  const growth = deriveValueInvestGrowth10y({
    eps: trailingEps,
    forwardEps: f.forwardEps,
    revenueGrowth: f.revenueGrowth,
    epsHistory,
  });
  const growthRate = growth.value;
  const growthSource = growth.source;
  const warnings = [...growth.warnings];

  if (growthRate == null) {
    missing.push("예상 이익 성장률");
  } else {
    sources.growthRate = growthSource ?? "";
  }

  const averagePer = f.per;
  if (averagePer == null || averagePer <= 0) {
    missing.push("PER");
  } else {
    sources.averagePer = f.source;
  }

  let payoutRatio = null;
  let payoutSource = null;
  if (
    f.dividendYield != null &&
    f.dividendYield > 0 &&
    currentPrice != null &&
    currentPrice > 0 &&
    currentEps != null &&
    currentEps > 0
  ) {
    payoutRatio = (f.dividendYield * currentPrice) / currentEps;
    payoutSource = "배당수익률×주가÷EPS";
    if (payoutRatio > 1) {
      warnings.push(
        `배당 성향 추정 ${(payoutRatio * 100).toFixed(0)}% — EPS 대비 배당이 과대 추정되어 100%로 제한`,
      );
    }
  }
  if (payoutRatio == null) {
    payoutRatio = 0;
    payoutSource = "배당 데이터 없음 — 0%";
  } else {
    payoutRatio = Math.max(0, Math.min(1, payoutRatio));
    sources.payoutRatio = payoutSource;
  }

  const roundedEps =
    currentEps != null && Number.isFinite(currentEps)
      ? Math.round(currentEps * 100) / 100
      : 0;

  /** @type {import("./value-invest-return-model.js").calcValueInvestReturn extends (i: infer I) => unknown ? I : never} */
  const inputs = {
    currentPrice: currentPrice ?? 0,
    currentEps: roundedEps,
    growthRate: growthRate ?? 0,
    averagePer: averagePer ?? 0,
    payoutRatio,
    targetReturnRate,
    years,
  };

  const result =
    missing.length === 0 ||
    (currentPrice && currentEps && averagePer && growthRate != null)
      ? calcValueInvestReturn(inputs)
      : calcValueInvestReturn({
          ...inputs,
          currentPrice: currentPrice > 0 ? currentPrice : NaN,
        });

  return {
    symbol: f.symbol,
    name: f.name,
    currency: f.currency,
    market: f.market,
    inputs,
    inputSources: sources,
    payoutSource,
    growthSource,
    warnings,
    result,
    missing,
    computable: Boolean(result && missing.length <= 1),
    epsHistory: epsAverage.years.length > 0 ? epsAverage.years : epsHistory,
    trailingEps,
    disclaimer:
      "실제 시장·재무 데이터 기반 추정이며 투자 권유가 아닙니다. 성장·PER·배당 가정에 따라 결과가 달라집니다.",
    updatedAtMs: Date.now(),
  };
}

/**
 * @param {string} symbol
 * @param {{ targetReturnRate?: number; years?: number; price?: number }} [opts]
 */
export async function loadValueInvestReturn(symbol, opts = {}) {
  const [fundamentals, epsHistory] = await Promise.all([
    loadStockFundamentals(symbol),
    loadAnnualEpsHistory(symbol).catch(() => []),
  ]);

  if (opts.price != null && Number.isFinite(opts.price) && opts.price > 0) {
    fundamentals.price = opts.price;
    sourcesPatch(fundamentals);
  }

  return buildValueInvestInputsFromFundamentals(fundamentals, { ...opts, epsHistory });
}

/** @param {Awaited<ReturnType<typeof loadStockFundamentals>>} f */
function sourcesPatch(f) {
  const base = f.source ? String(f.source) : "";
  f.source = base.includes("실시간") ? base : base ? `${base} · 실시간 주가` : "실시간 주가";
}
