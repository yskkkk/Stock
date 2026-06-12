import type { TossTestHolding } from "../api";
import { holdingNetReturnPctFromCost } from "./livePortfolioPnl";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "./netReturn";

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

/** 보유 합산 총수익률(%) — 매도 수수료 반영 순평가, USD는 환율 환산 */
export function tossHoldingsNetReturnPct(
  holdings: TossTestHolding[],
  usdKrwRate: number | null,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  let costKrw = 0;
  let netMktKrw = 0;

  for (const h of holdings) {
    const cost = tossHoldingCostBasis(h);
    const netMv = tossHoldingNetMarketValue(h, roundTripFeeRate);
    if (cost == null || netMv == null) continue;

    if (h.currency === "USD") {
      if (!(usdKrwRate != null && usdKrwRate > 0)) continue;
      costKrw += cost * usdKrwRate;
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
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number | null {
  let plKrw = 0;
  let hasKrw = false;
  let hasUsd = false;
  let plUsd = 0;

  for (const h of holdings) {
    const pnl = tossHoldingNetUnrealizedPnl(h, roundTripFeeRate);
    if (pnl == null) continue;
    if (h.currency === "USD") {
      plUsd += pnl;
      hasUsd = true;
    } else {
      plKrw += pnl;
      hasKrw = true;
    }
  }

  if (!hasKrw && !hasUsd) return null;
  if (hasUsd) {
    if (!(usdKrwRate != null && usdKrwRate > 0)) {
      return hasKrw ? plKrw : null;
    }
    return plKrw + plUsd * usdKrwRate;
  }
  return plKrw;
}
