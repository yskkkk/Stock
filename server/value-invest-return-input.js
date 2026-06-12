/**
 * 가치투자 10년 수익 모델 — 실제 시장·재무 데이터 조립
 */
import { calcValueInvestReturn } from "./value-invest-return-model.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";

const DEFAULT_TARGET_RETURN = 0.15;
const DEFAULT_YEARS = 10;

/**
 * @param {Awaited<ReturnType<typeof loadStockFundamentals>>} f
 */
export function buildValueInvestInputsFromFundamentals(f, opts = {}) {
  const targetReturnRate = opts.targetReturnRate ?? DEFAULT_TARGET_RETURN;
  const years = opts.years ?? DEFAULT_YEARS;
  const missing = [];
  const sources = {};

  const currentPrice = f.price;
  const currentEps = f.eps;
  if (currentPrice == null || currentPrice <= 0) {
    missing.push("현재가");
  } else {
    sources.currentPrice = f.source;
  }
  if (currentEps == null || currentEps <= 0) {
    missing.push("EPS");
  } else {
    sources.currentEps = f.source;
  }

  let growthRate = null;
  let growthSource = null;
  if (
    f.forwardEps != null &&
    f.forwardEps > 0 &&
    currentEps != null &&
    currentEps > 0
  ) {
    growthRate = f.forwardEps / currentEps - 1;
    growthSource = "Forward EPS ÷ Trailing EPS";
  } else if (f.revenueGrowth != null && Number.isFinite(f.revenueGrowth)) {
    growthRate = f.revenueGrowth;
    growthSource = "Yahoo revenueGrowth";
  }
  if (growthRate == null) {
    missing.push("예상 이익 성장률");
  } else {
    sources.growthRate = growthSource;
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
  }
  if (payoutRatio == null) {
    payoutRatio = 0;
    payoutSource = "배당 데이터 없음 — 0%";
  } else {
    payoutRatio = Math.max(0, Math.min(1, payoutRatio));
    sources.payoutRatio = payoutSource;
  }

  /** @type {import("./value-invest-return-model.js").calcValueInvestReturn extends (i: infer I) => unknown ? I : never} */
  const inputs = {
    currentPrice: currentPrice ?? 0,
    currentEps: currentEps ?? 0,
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
    result,
    missing,
    computable: Boolean(result && missing.length <= 1),
    disclaimer:
      "실제 시장·재무 데이터 기반 추정이며 투자 권유가 아닙니다. 성장·PER·배당 가정에 따라 결과가 달라집니다.",
    updatedAtMs: Date.now(),
  };
}

/**
 * @param {string} symbol
 * @param {{ targetReturnRate?: number; years?: number }} [opts]
 */
export async function loadValueInvestReturn(symbol, opts = {}) {
  const fundamentals = await loadStockFundamentals(symbol);
  return buildValueInvestInputsFromFundamentals(fundamentals, opts);
}
