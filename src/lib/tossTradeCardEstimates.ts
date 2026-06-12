import type { LiveTradeMarket } from "../types";
import { normalizeRoundTripFeeRate, DEFAULT_ROUND_TRIP_FEE_RATE } from "./netReturn";

/** 국내 상장 매도 시 증권거래세 등 간이 추정(토스 앱 표시와 유사) */
export const KR_LISTED_SALE_TAX_RATE = 0.002;

export function roundTripFeeForMarket(
  market: LiveTradeMarket,
  roundTripByMarket?: Partial<Record<LiveTradeMarket, number>>,
): number {
  const raw =
    roundTripByMarket?.[market] ??
    roundTripByMarket?.default ??
    DEFAULT_ROUND_TRIP_FEE_RATE;
  return normalizeRoundTripFeeRate(raw);
}

export function estimateSellFeeAmount(
  grossAmount: number,
  roundTripFeeRate: number,
): number {
  if (!(grossAmount > 0) || !Number.isFinite(grossAmount)) return 0;
  return Math.round(grossAmount * (normalizeRoundTripFeeRate(roundTripFeeRate) / 2));
}

export function estimateSaleTaxAmount(
  grossAmount: number,
  market: LiveTradeMarket,
): number {
  if (market !== "kr" || !(grossAmount > 0)) return 0;
  return Math.round(grossAmount * KR_LISTED_SALE_TAX_RATE);
}
