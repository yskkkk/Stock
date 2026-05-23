import type { LiveTradingFeeRates } from "../api";
import type { LiveTradeFeeRateByMarket } from "./livePortfolioLiveQuotes";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "./netReturn";

export function feeByMarketFromStatus(
  feeRates?: LiveTradingFeeRates | null,
): LiveTradeFeeRateByMarket {
  const crypto =
    feeRates?.bithumb?.roundTripFeeRate != null
      ? normalizeRoundTripFeeRate(feeRates.bithumb.roundTripFeeRate)
      : DEFAULT_ROUND_TRIP_FEE_RATE;
  const stock = normalizeRoundTripFeeRate(
    feeRates?.toss?.roundTripFeeRate ?? DEFAULT_ROUND_TRIP_FEE_RATE,
  );
  return { crypto, kr: stock, us: stock, default: DEFAULT_ROUND_TRIP_FEE_RATE };
}
