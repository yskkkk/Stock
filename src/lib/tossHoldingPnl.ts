import type { TossTestHolding } from "../api";
import { holdingNetReturnPctFromCost } from "./livePortfolioPnl";
import {
  tossRoundTripForHolding,
  type TossFeeRatesByMarket,
} from "./tossHoldingFeeRates";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "./netReturn";

export type TossFeeRateInput = number | TossFeeRatesByMarket;

function feeForHolding(h: TossTestHolding, fee: TossFeeRateInput): number {
  if (typeof fee === "number") return normalizeRoundTripFeeRate(fee);
  return tossRoundTripForHolding(h.market, fee);
}

export function tossHoldingCostBasis(h: TossTestHolding): number | null {
  const avg = h.avgBuyPrice;
  const qty = h.quantity;
  if (avg == null || !(avg > 0) || !(qty > 0)) return null;
  const cost = avg * qty;
  return Number.isFinite(cost) ? cost : null;
}

export function tossHoldingGrossMarketValue(h: TossTestHolding): number | null {
  if (h.marketValue != null && Number.isFinite(h.marketValue) && h.marketValue > 0) {
    return h.marketValue;
  }
  if (
    h.currentPrice != null &&
    Number.isFinite(h.currentPrice) &&
    h.currentPrice > 0 &&
    h.quantity > 0
  ) {
    return h.currentPrice * h.quantity;
  }
  return null;
}

/** 매도 수수료(왕복의 절반) 반영 순평가액 */
export function tossHoldingNetMarketValue(
  h: TossTestHolding,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  const mv = tossHoldingGrossMarketValue(h);
  if (mv == null) return null;
  const askFee = normalizeRoundTripFeeRate(roundTripFeeRate) / 2;
  return Math.round(mv * (1 - askFee));
}

export function tossHoldingNetUnrealizedPnl(
  h: TossTestHolding,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  const cost = tossHoldingCostBasis(h);
  const netMv = tossHoldingNetMarketValue(h, roundTripFeeRate);
  if (cost == null || netMv == null) return null;
  const pnl = netMv - cost;
  return Number.isFinite(pnl) ? pnl : null;
}

export function tossHoldingNetReturnPercent(
  h: TossTestHolding,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  const cost = tossHoldingCostBasis(h);
  const mv = tossHoldingGrossMarketValue(h);
  if (cost == null || mv == null) return null;
  return holdingNetReturnPctFromCost(cost, mv, roundTripFeeRate);
}

/**
 * USD 보유 → 원화 평가손익.
 * 매입 환율이 있으면 매입원금×매입환율 vs 순평가×현재환율(환차 포함).
 */
export function tossHoldingNetUnrealizedPnlKrw(
  h: TossTestHolding,
  currentUsdKrw: number | null,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
  avgPurchaseFx: number | null = null,
): number | null {
  const isUsd = h.currency === "USD" || h.market === "us";
  if (!isUsd) {
    return tossHoldingNetUnrealizedPnl(h, roundTripFeeRate);
  }
  if (!(currentUsdKrw != null && currentUsdKrw > 0)) return null;
  const costUsd = tossHoldingCostBasis(h);
  const netMvUsd = tossHoldingNetMarketValue(h, roundTripFeeRate);
  if (costUsd == null || netMvUsd == null) return null;
  const buyFx =
    avgPurchaseFx != null && Number.isFinite(avgPurchaseFx) && avgPurchaseFx > 0
      ? avgPurchaseFx
      : currentUsdKrw;
  const pnl = netMvUsd * currentUsdKrw - costUsd * buyFx;
  return Number.isFinite(pnl) ? Math.round(pnl) : null;
}

/** 보유 합산 총수익률(%) — 매도 수수료 반영 순평가, USD는 매입·현재 환율 */
export function tossHoldingsNetReturnPct(
  holdings: TossTestHolding[],
  usdKrwRate: number | null,
  feeInput: TossFeeRateInput = DEFAULT_ROUND_TRIP_FEE_RATE,
  purchaseFxBySymbol?: Map<string, number> | null,
): number | null {
  let costKrw = 0;
  let netMktKrw = 0;

  for (const h of holdings) {
    const cost = tossHoldingCostBasis(h);
    const netMv = tossHoldingNetMarketValue(h, feeForHolding(h, feeInput));
    if (cost == null || netMv == null) continue;

    if (h.currency === "USD" || h.market === "us") {
      if (!(usdKrwRate != null && usdKrwRate > 0)) continue;
      const buyFx =
        purchaseFxBySymbol?.get(String(h.symbol ?? "").toUpperCase()) ??
        usdKrwRate;
      costKrw += cost * buyFx;
      netMktKrw += netMv * usdKrwRate;
    } else {
      costKrw += cost;
      netMktKrw += netMv;
    }
  }

  if (!(costKrw > 0)) return null;
  const pct = ((netMktKrw - costKrw) / costKrw) * 100;
  return Number.isFinite(pct) ? pct : null;
}

export function tossHoldingsNetProfitLossKrw(
  holdings: TossTestHolding[],
  usdKrwRate: number | null,
  feeInput: TossFeeRateInput = DEFAULT_ROUND_TRIP_FEE_RATE,
  purchaseFxBySymbol?: Map<string, number> | null,
): number | null {
  let plKrw = 0;
  let hasAny = false;

  for (const h of holdings) {
    const fee = feeForHolding(h, feeInput);
    const buyFx =
      purchaseFxBySymbol?.get(String(h.symbol ?? "").toUpperCase()) ?? null;
    const pnl = tossHoldingNetUnrealizedPnlKrw(h, usdKrwRate, fee, buyFx);
    if (pnl == null) continue;
    plKrw += pnl;
    hasAny = true;
  }

  return hasAny ? plKrw : null;
}

export type TossSummarySlice = {
  profitLossKrw?: number | null;
  profitLossUsd?: number | null;
  marketValueKrw?: number | null;
  marketValueUsd?: number | null;
  totalReturnPct?: number | null;
};

/** 보유 종목 순평가액 합계(원) — USD는 환율 환산, summary 폴백 */
export function tossHoldingsTotalNetMarketValueKrw(
  holdings: TossTestHolding[],
  summary: TossSummarySlice | null | undefined,
  usdKrwRate: number | null,
  feeInput: TossFeeRateInput = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  let krw = 0;
  let usd = 0;
  let hasAny = false;

  for (const h of holdings) {
    const netMv = tossHoldingNetMarketValue(h, feeForHolding(h, feeInput));
    if (netMv == null || !(netMv > 0)) continue;
    hasAny = true;
    if (h.currency === "USD") {
      usd += netMv;
    } else {
      krw += netMv;
    }
  }

  if (hasAny) {
    if (usd > 0) {
      if (!(usdKrwRate != null && usdKrwRate > 0)) {
        return krw > 0 ? Math.round(krw) : null;
      }
      return Math.round(krw + usd * usdKrwRate);
    }
    return Math.round(krw);
  }

  if (!summary) return null;
  const mvK = summary.marketValueKrw;
  const mvU = summary.marketValueUsd;
  const hasK = mvK != null && Number.isFinite(mvK) && mvK > 0;
  const hasU = mvU != null && Number.isFinite(mvU) && mvU > 0;
  if (!hasK && !hasU) return null;
  if (hasU) {
    if (!(usdKrwRate != null && usdKrwRate > 0)) {
      return hasK ? Math.round(mvK!) : null;
    }
    return Math.round((hasK ? mvK! : 0) + mvU! * usdKrwRate);
  }
  return Math.round(mvK!);
}

/** 계좌 전체 평가손익(원)·수익률 — KRW+USD 환산 합산(매입환율 반영) */
export function computeTossAccountCombinedPnl(
  holdings: TossTestHolding[],
  summary: TossSummarySlice | null | undefined,
  usdKrwRate: number | null,
  feeInput: TossFeeRateInput = DEFAULT_ROUND_TRIP_FEE_RATE,
  purchaseFxBySymbol?: Map<string, number> | null,
): { profitLossKrw: number | null; totalReturnPct: number | null } {
  const fromHoldings = {
    profitLossKrw: tossHoldingsNetProfitLossKrw(
      holdings,
      usdKrwRate,
      feeInput,
      purchaseFxBySymbol,
    ),
    totalReturnPct: tossHoldingsNetReturnPct(
      holdings,
      usdKrwRate,
      feeInput,
      purchaseFxBySymbol,
    ),
  };

  const hasUsd =
    holdings.some((h) => h.currency === "USD" || h.market === "us") ||
    (summary?.profitLossUsd != null && summary.profitLossUsd !== 0) ||
    (summary?.marketValueUsd != null && summary.marketValueUsd > 0);

  if (
    fromHoldings.profitLossKrw != null &&
    fromHoldings.totalReturnPct != null &&
    (!hasUsd || (usdKrwRate != null && usdKrwRate > 0))
  ) {
    return fromHoldings;
  }

  if (usdKrwRate != null && usdKrwRate > 0 && summary) {
    const plK = summary.profitLossKrw;
    const plU = summary.profitLossUsd;
    const mvK = summary.marketValueKrw;
    const mvU = summary.marketValueUsd;

    let profitLossKrw: number | null = null;
    if (plK != null || plU != null) {
      profitLossKrw =
        (plK != null && Number.isFinite(plK) ? plK : 0) +
        (plU != null && Number.isFinite(plU) ? plU * usdKrwRate : 0);
    }

    let totalReturnPct = fromHoldings.totalReturnPct;
    const costKrw =
      (mvK != null && Number.isFinite(mvK) && plK != null ? mvK - plK : 0) +
      (mvU != null && Number.isFinite(mvU) && plU != null
        ? (mvU - plU) * usdKrwRate
        : 0);
    if (costKrw > 0 && profitLossKrw != null) {
      totalReturnPct = (profitLossKrw / costKrw) * 100;
    }

    if (profitLossKrw != null || totalReturnPct != null) {
      return {
        profitLossKrw: profitLossKrw ?? fromHoldings.profitLossKrw,
        totalReturnPct: totalReturnPct ?? fromHoldings.totalReturnPct,
      };
    }
  }

  if (!hasUsd && fromHoldings.profitLossKrw != null) {
    return fromHoldings;
  }

  return {
    profitLossKrw:
      fromHoldings.profitLossKrw ??
      (summary?.profitLossKrw != null && Number.isFinite(summary.profitLossKrw)
        ? summary.profitLossKrw
        : null),
    totalReturnPct:
      fromHoldings.totalReturnPct ??
      (summary?.totalReturnPct != null && Number.isFinite(summary.totalReturnPct)
        ? summary.totalReturnPct
        : null),
  };
}
