import type { ExchangeTradingFeeRateInfo, TossTestHolding } from "../api";
import { TOSS_FIXED_ROUND_TRIP_FEE_RATE, normalizeRoundTripFeeRate } from "./netReturn";

export type TossFeeRatesByMarket = {
  kr?: number | null;
  us?: number | null;
  source?: "api" | "default" | "env";
};

export function tossRoundTripForHolding(
  _market: TossTestHolding["market"],
  _rates?: TossFeeRatesByMarket | null,
): number {
  return normalizeRoundTripFeeRate(TOSS_FIXED_ROUND_TRIP_FEE_RATE);
}

export function tossFeeRatesFromLegacy(
  _roundTripFeeRate?: number | null,
  _source?: TossFeeRatesByMarket["source"],
): TossFeeRatesByMarket | null {
  return {
    kr: TOSS_FIXED_ROUND_TRIP_FEE_RATE,
    us: TOSS_FIXED_ROUND_TRIP_FEE_RATE,
    source: "default",
  };
}

export function tossFeeRatesFromStatus(
  _toss?: ExchangeTradingFeeRateInfo | null,
): TossFeeRatesByMarket | null {
  return {
    kr: TOSS_FIXED_ROUND_TRIP_FEE_RATE,
    us: TOSS_FIXED_ROUND_TRIP_FEE_RATE,
    source: "default",
  };
}

export function mergeTossFeeRates(
  _primary?: TossFeeRatesByMarket | null,
  _fallback?: TossFeeRatesByMarket | null,
): TossFeeRatesByMarket {
  return {
    kr: TOSS_FIXED_ROUND_TRIP_FEE_RATE,
    us: TOSS_FIXED_ROUND_TRIP_FEE_RATE,
    source: "default",
  };
}
