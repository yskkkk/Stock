import type { LiveTradeHolding } from "../api";
import type { LiveTradeMarket } from "../types";
import type { LiveTradingFeeRates } from "../api";
import type { LiveTradeFeeRateByMarket } from "./livePortfolioLiveQuotes";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "./netReturn";

function feePct(n: number): string {
  return `${(n * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}

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

export function buildPortfolioFeeNote(
  holdings: Pick<LiveTradeHolding, "market">[],
  roundTripForMarket: (market: LiveTradeMarket) => number,
): string {
  const markets = new Set<LiveTradeMarket>();
  for (const h of holdings) {
    const m = h.market;
    if (m === "kr" || m === "us" || m === "crypto") markets.add(m);
  }
  const list = markets.size > 0 ? [...markets] : (["kr"] as LiveTradeMarket[]);
  const roundTrips = list.map((m) => roundTripForMarket(m));
  const unique = [...new Set(roundTrips.map((r) => r.toFixed(8)))];
  if (unique.length === 1) {
    const rt = roundTrips[0] ?? DEFAULT_ROUND_TRIP_FEE_RATE;
    const half = rt / 2;
    return `매수 ${feePct(half)} · 매도 ${feePct(half)} (왕복 ${feePct(rt)})`;
  }
  return list
    .map((m) => {
      const rt = roundTripForMarket(m);
      const label = m === "crypto" ? "코인" : m === "us" ? "미국" : "국내";
      return `${label} 왕복 ${feePct(rt)}`;
    })
    .join(" · ");
}
