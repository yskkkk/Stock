/**
 * 가치투자 10년 수익 모델 — 실제 시장·재무 데이터 조립
 */
import { calcValueInvestReturn } from "./value-invest-return-model.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import { deriveValueInvestGrowth10y, buildEpsGrowthByYear } from "./value-invest-growth.js";
import {
  averageEpsFromHistory,
  EPS_AVERAGE_MAX_YEARS,
  loadAnnualEpsHistory,
} from "./value-invest-eps-history.js";
import { loadStock } from "./stock-data.js";

const DEFAULT_TARGET_RETURN = 0.15;
const DEFAULT_YEARS = 10;

/** 역사적 PER 산출에 쓰는 최대 연수 (EPS 평균과 동일) */
export const PER_HISTORY_MAX_YEARS = 10;

/**
 * @param {{ time?: unknown; timeSec?: number }} candle
 * @param {"kr"|"us"|string} [market]
 * @returns {number | null}
 */
export function candleCalendarYear(candle, market = "us") {
  const t = candle?.time;
  if (t && typeof t === "object" && "year" in t) {
    const y = Number(/** @type {{ year?: unknown }} */ (t).year);
    return Number.isFinite(y) ? y : null;
  }
  const sec =
    typeof candle?.timeSec === "number" && Number.isFinite(candle.timeSec)
      ? candle.timeSec
      : typeof t === "number" && Number.isFinite(t)
        ? t > 1e12
          ? Math.floor(t / 1000)
          : t
        : null;
  if (sec == null) return null;
  // KR 마켓은 KST(UTC+9) 기준 연도 — UTC 서버에서도 연말 경계 오류 없도록
  const offsetSec = market === "kr" ? 9 * 3600 : 0;
  return new Date((sec + offsetSec) * 1000).getUTCFullYear();
}

/**
 * 역사적 평균 PER: 연도별 평균주가 ÷ 연도별 EPS
 * @param {{ year: number; eps: number }[]} epsHistory
 * @param {{ candles?: { time?: unknown; timeSec?: number; close: number }[] } | null} candleData
 * @param {number} [maxYears]
 * @param {"kr"|"us"|string} [market]
 * @returns {{ avg: number | null; perByYear: { year: number; per: number; avgPrice: number }[]; source: string | null }}
 */
export function computeHistoricalAveragePer(epsHistory, candleData, maxYears = PER_HISTORY_MAX_YEARS, market = "us") {
  const candles = Array.isArray(candleData?.candles) ? candleData.candles : [];
  if (!candles.length || !epsHistory.length) return { avg: null, perByYear: [], source: null };

  /** @type {Map<number, number[]>} */
  const pricesByYear = new Map();
  for (const c of candles) {
    if (!Number.isFinite(c.close) || c.close <= 0) continue;
    const year = candleCalendarYear(c, market);
    if (year == null) continue;
    if (!pricesByYear.has(year)) pricesByYear.set(year, []);
    pricesByYear.get(year).push(c.close);
  }

  const perByYear = [];
  for (const { year, eps } of epsHistory) {
    if (eps <= 0) continue;
    const prices = pricesByYear.get(year);
    if (!prices?.length) continue;
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const per = avgPrice / eps;
    if (Number.isFinite(per) && per > 1 && per < 300) {
      perByYear.push({ year, per: Math.round(per * 100) / 100, avgPrice: Math.round(avgPrice * 100) / 100 });
    }
  }

  if (!perByYear.length) return { avg: null, perByYear: [], source: null };

  perByYear.sort((a, b) => a.year - b.year);
  const recent =
    perByYear.length > maxYears ? perByYear.slice(-maxYears) : perByYear;
  const avg = recent.reduce((sum, r) => sum + r.per, 0) / recent.length;
  const start = recent[0].year;
  const end = recent[recent.length - 1].year;
  const spanNote =
    recent.length < maxYears ? `, 상장 ${recent.length}년` : "";
  return {
    avg: Number.isFinite(avg) && avg > 0 ? Math.round(avg * 100) / 100 : null,
    perByYear: recent,
    source: `역사적 평균 PER ${start}→${end} (${recent.length}년${spanNote}, 연평균주가÷EPS)`,
  };
}

/**
 * @param {Awaited<ReturnType<typeof loadStockFundamentals>>} f
 * @param {{ targetReturnRate?: number; years?: number; epsHistory?: { year: number; eps: number }[]; historicalPer?: ReturnType<typeof computeHistoricalAveragePer> }} opts
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
  const growthDetail = growth.detail ?? null;
  const warnings = [...growth.warnings];
  if (epsHistory.length > 0 && epsHistory.length < EPS_AVERAGE_MAX_YEARS) {
    warnings.push(
      `연간 EPS 이력 ${epsHistory.length}년 — Naver/Yahoo API가 최근 ${epsHistory.length}년만 제공`,
    );
  }

  if (growthRate == null) {
    missing.push("예상 이익 성장률");
  } else {
    sources.growthRate = growthSource ?? "";
  }

  // 역사적 평균 PER 우선, 없으면 현재 Trailing PER 폴백
  const historicalPerData = opts.historicalPer ?? null;
  const averagePer = (historicalPerData?.avg != null && historicalPerData.avg > 0)
    ? historicalPerData.avg
    : f.per;
  const averagePerSource = (historicalPerData?.avg != null && historicalPerData.avg > 0)
    ? historicalPerData.source
    : f.source;

  if (averagePer == null || averagePer <= 0) {
    missing.push("PER");
  } else {
    sources.averagePer = averagePerSource ?? f.source;
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
    growthDetail,
    epsGrowthByYear: buildEpsGrowthByYear(epsHistory),
    historicalPerData: historicalPerData ?? null,
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
  const [fundamentals, epsHistory, candleData] = await Promise.all([
    loadStockFundamentals(symbol),
    loadAnnualEpsHistory(symbol).catch(() => []),
    loadStock(symbol, "1d").catch(() => null),
  ]);

  if (opts.price != null && Number.isFinite(opts.price) && opts.price > 0) {
    fundamentals.price = opts.price;
    sourcesPatch(fundamentals);
  }

  const historicalPer = computeHistoricalAveragePer(epsHistory, candleData, undefined, fundamentals.market);

  return buildValueInvestInputsFromFundamentals(fundamentals, { ...opts, epsHistory, historicalPer });
}

/** @param {Awaited<ReturnType<typeof loadStockFundamentals>>} f */
function sourcesPatch(f) {
  const base = f.source ? String(f.source) : "";
  f.source = base.includes("실시간") ? base : base ? `${base} · 실시간 주가` : "실시간 주가";
}
