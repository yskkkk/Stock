import type { ExchangeTradingFeeRateInfo, TossTestHolding } from "../api";
import { DEFAULT_ROUND_TRIP_FEE_RATE, normalizeRoundTripFeeRate } from "./netReturn";

export type TossFeeRatesByMarket = {
  kr?: number | null;
  us?: number | null;
  source?: "api" | "default" | "env";
};

export function tossRoundTripForHolding(
  market: TossTestHolding["market"],
  rates?: TossFeeRatesByMarket | null,
): number {
  const key = market === "us" ? "us" : "kr";
  const specific = key === "us" ? rates?.us : rates?.kr;
  if (
    rates?.source === "api" &&
    specific != null &&
    Number.isFinite(specific) &&
    specific >= 0
  ) {
    return normalizeRoundTripFeeRate(specific);
  }
  const fallback =
    specific ??
    rates?.kr ??
    rates?.us ??
    DEFAULT_ROUND_TRIP_FEE_RATE;
  return normalizeRoundTripFeeRate(fallback);
}

export function tossFeeRatesFromLegacy(
  roundTripFeeRate?: number | null,
  source?: TossFeeRatesByMarket["source"],
): TossFeeRatesByMarket | null {
  if (roundTripFeeRate == null || !Number.isFinite(roundTripFeeRate)) return null;
  return {
    kr: roundTripFeeRate,
    us: roundTripFeeRate,
    source: source ?? "default",
  };
}

export function tossFeeRatesFromStatus(
  toss?: ExchangeTradingFeeRateInfo | null,
): TossFeeRatesByMarket | null {
  if (!toss) return null;
  return {
    kr: toss.krRoundTripFeeRate ?? toss.roundTripFeeRate,
    us: toss.usRoundTripFeeRate ?? toss.roundTripFeeRate,
    source: toss.source,
  };
}

export function mergeTossFeeRates(
  primary?: TossFeeRatesByMarket | null,
  fallback?: TossFeeRatesByMarket | null,
): TossFeeRatesByMarket {
  return {
    kr: primary?.kr ?? fallback?.kr ?? null,
    us: primary?.us ?? fallback?.us ?? null,
    source: primary?.source ?? fallback?.source ?? "default",
  };
}
