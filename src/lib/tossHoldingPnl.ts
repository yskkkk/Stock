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
  const qty = h.quantity;
  if (!(qty > 0)) return null;
  const purchase = h.purchaseAmount;
  if (purchase != null && Number.isFinite(purchase) && purchase > 0) {
    return purchase;
  }
  const avg = h.avgBuyPrice;
  if (avg == null || !(avg > 0)) return null;
  const cost = avg * qty;
  return Number.isFinite(cost) ? cost : null;
}

/** US avg buy in KRW = USD avg * purchase FX (Toss has no KRW avg for US stocks). */
export function tossHoldingAvgBuyPriceKrw(
  h: TossTestHolding,
  avgPurchaseFx: number | null,
  currentUsdKrw: number | null,
): number | null {
  const isUsd = h.currency === "USD" || h.market === "us";
  if (!isUsd) {
    return h.avgBuyPrice != null && h.avgBuyPrice > 0 ? h.avgBuyPrice : null;
  }
  const avgUsd = h.avgBuyPrice;
  if (!(avgUsd != null && avgUsd > 0)) return null;
  const fx =
    avgPurchaseFx != null && Number.isFinite(avgPurchaseFx) && avgPurchaseFx > 0
      ? avgPurchaseFx
      : currentUsdKrw != null && currentUsdKrw > 0
        ? currentUsdKrw
        : null;
  if (fx == null) return null;
  const krw = avgUsd * fx;
  return Number.isFinite(krw) ? krw : null;
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

/** Net market value after round-trip fee (0.2%). USD keeps 2 decimal places. */
export function tossHoldingNetMarketValue(
  h: TossTestHolding,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  const mv = tossHoldingGrossMarketValue(h);
  if (mv == null) return null;
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  const net = mv * (1 - fee);
  if (!Number.isFinite(net) || !(net > 0)) return null;
  const isUsd = h.currency === "USD" || h.market === "us";
  if (isUsd) return Math.round(net * 100) / 100;
  return Math.round(net);
}

export function tossHoldingNetUnrealizedPnl(
  h: TossTestHolding,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  const cost = tossHoldingCostBasis(h);
  const netMv = tossHoldingNetMarketValue(h, roundTripFeeRate);
  if (cost == null || netMv == null) return null;
  const pnl = netMv - cost;
  if (!Number.isFinite(pnl)) return null;
  const isUsd = h.currency === "USD" || h.market === "us";
  if (isUsd) return Math.round(pnl * 100) / 100;
  return Math.round(pnl);
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
 * USD holding PnL in KRW.
 * With purchase FX: netMv*spotFx - cost*buyFx (includes FX gain/loss).
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

/** Portfolio net return % in KRW (USD uses purchase vs spot FX). */
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
  purchaseAmountKrw?: number | null;
  purchaseAmountUsd?: number | null;
  totalReturnPct?: number | null;
};

/** Total net market value in KRW. */
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
  const fee =
    typeof feeInput === "number"
      ? normalizeRoundTripFeeRate(feeInput)
      : DEFAULT_ROUND_TRIP_FEE_RATE;
  const mvK = summary.marketValueKrw;
  const mvU = summary.marketValueUsd;
  const hasK = mvK != null && Number.isFinite(mvK) && mvK > 0;
  const hasU = mvU != null && Number.isFinite(mvU) && mvU > 0;
  if (!hasK && !hasU) return null;
  const netK = hasK ? mvK! * (1 - fee) : 0;
  const netU = hasU ? mvU! * (1 - fee) : 0;
  if (hasU) {
    if (!(usdKrwRate != null && usdKrwRate > 0)) {
      return hasK ? Math.round(netK) : null;
    }
    return Math.round(netK + netU * usdKrwRate);
  }
  return Math.round(netK);
}

/** Combined account PnL in KRW (purchase FX for USD). */
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

/** Per-holding PnL in display currency (USD mode excludes FX). */
export function tossHoldingNetUnrealizedPnlDisplay(
  h: TossTestHolding,
  displayCurrency: "KRW" | "USD",
  currentUsdKrw: number | null,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
  avgPurchaseFx: number | null = null,
): number | null {
  const isUsd = h.currency === "USD" || h.market === "us";
  if (displayCurrency === "KRW") {
    return tossHoldingNetUnrealizedPnlKrw(h, currentUsdKrw, roundTripFeeRate, avgPurchaseFx);
  }
  if (isUsd) {
    return tossHoldingNetUnrealizedPnl(h, roundTripFeeRate);
  }
  if (!(currentUsdKrw != null && currentUsdKrw > 0)) return null;
  const pnlKrw = tossHoldingNetUnrealizedPnl(h, roundTripFeeRate);
  if (pnlKrw == null) return null;
  const pnlUsd = pnlKrw / currentUsdKrw;
  return Number.isFinite(pnlUsd) ? pnlUsd : null;
}

export function tossHoldingNetReturnPercentDisplay(
  h: TossTestHolding,
  displayCurrency: "KRW" | "USD",
  currentUsdKrw: number | null,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
  avgPurchaseFx: number | null = null,
): number | null {
  const isUsd = h.currency === "USD" || h.market === "us";
  if (displayCurrency === "USD" || !isUsd) {
    return tossHoldingNetReturnPercent(h, roundTripFeeRate);
  }
  if (!(currentUsdKrw != null && currentUsdKrw > 0)) return null;
  const costUsd = tossHoldingCostBasis(h);
  const mvUsd = tossHoldingGrossMarketValue(h);
  if (costUsd == null || mvUsd == null) return null;
  const buyFx =
    avgPurchaseFx != null && Number.isFinite(avgPurchaseFx) && avgPurchaseFx > 0
      ? avgPurchaseFx
      : currentUsdKrw;
  const costKrw = costUsd * buyFx;
  const mvKrw = mvUsd * currentUsdKrw;
  if (!(costKrw > 0)) return null;
  return holdingNetReturnPctFromCost(costKrw, mvKrw, roundTripFeeRate);
}

/**
 * Holdings PnL/return for KRW vs USD toggle.
 * KRW: purchaseFx * USD cost vs spotFx * market (FX included).
 * USD: Toss USD avg/purchaseAmount (no FX).
 */
export function computeTossHoldingsDisplayPnl(
  holdings: TossTestHolding[],
  usdKrwRate: number | null,
  feeInput: TossFeeRateInput = DEFAULT_ROUND_TRIP_FEE_RATE,
  purchaseFxBySymbol: Map<string, number> | null | undefined,
  displayCurrency: "KRW" | "USD",
): { pnl: number | null; returnPct: number | null } {
  if (displayCurrency === "KRW") {
    return {
      pnl: tossHoldingsNetProfitLossKrw(
        holdings,
        usdKrwRate,
        feeInput,
        purchaseFxBySymbol,
      ),
      returnPct: tossHoldingsNetReturnPct(
        holdings,
        usdKrwRate,
        feeInput,
        purchaseFxBySymbol,
      ),
    };
  }

  let costUsd = 0;
  let netMvUsd = 0;
  let hasAny = false;

  for (const h of holdings) {
    const fee = feeForHolding(h, feeInput);
    const cost = tossHoldingCostBasis(h);
    const netMv = tossHoldingNetMarketValue(h, fee);
    if (cost == null || netMv == null) continue;
    const isUsd = h.currency === "USD" || h.market === "us";
    if (isUsd) {
      costUsd += cost;
      netMvUsd += netMv;
      hasAny = true;
    } else if (usdKrwRate != null && usdKrwRate > 0) {
      costUsd += cost / usdKrwRate;
      netMvUsd += netMv / usdKrwRate;
      hasAny = true;
    }
  }

  if (!hasAny || !(costUsd > 0)) {
    return { pnl: null, returnPct: null };
  }
  const pnl = netMvUsd - costUsd;
  const returnPct = (pnl / costUsd) * 100;
  return {
    pnl: Number.isFinite(pnl) ? pnl : null,
    returnPct: Number.isFinite(returnPct) ? returnPct : null,
  };
}
