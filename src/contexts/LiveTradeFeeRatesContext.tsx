import { createContext, useContext, useMemo } from "react";
import type { LiveTradeMarket } from "../types";
import type { LiveTradingFeeRates } from "../api";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "../lib/netReturn";

export type LiveTradeFeeRatesContextValue = {
  roundTripForMarket: (market: LiveTradeMarket) => number;
  bithumbLabelKo: string | null;
  feeRates: LiveTradingFeeRates | null;
};

const defaultValue: LiveTradeFeeRatesContextValue = {
  roundTripForMarket: () => DEFAULT_ROUND_TRIP_FEE_RATE,
  bithumbLabelKo: null,
  feeRates: null,
};

export const LiveTradeFeeRatesContext =
  createContext<LiveTradeFeeRatesContextValue>(defaultValue);

export function LiveTradeFeeRatesProvider({
  feeRates,
  children,
}: {
  feeRates: LiveTradingFeeRates | null | undefined;
  children: React.ReactNode;
}) {
  const value = useMemo((): LiveTradeFeeRatesContextValue => {
    const fr = feeRates ?? null;
    const crypto =
      fr?.bithumb?.roundTripFeeRate != null
        ? normalizeRoundTripFeeRate(fr.bithumb.roundTripFeeRate)
        : DEFAULT_ROUND_TRIP_FEE_RATE;
    const kr =
      fr?.toss?.roundTripFeeRate != null
        ? normalizeRoundTripFeeRate(fr.toss.roundTripFeeRate)
        : DEFAULT_ROUND_TRIP_FEE_RATE;
    return {
      feeRates: fr,
      bithumbLabelKo: fr?.bithumb?.labelKo ?? null,
      roundTripForMarket: (market) => {
        if (market === "crypto") return crypto;
        if (market === "kr" || market === "us") return kr;
        return DEFAULT_ROUND_TRIP_FEE_RATE;
      },
    };
  }, [feeRates]);

  return (
    <LiveTradeFeeRatesContext.Provider value={value}>
      {children}
    </LiveTradeFeeRatesContext.Provider>
  );
}

export function useLiveTradeFeeRates() {
  return useContext(LiveTradeFeeRatesContext);
}
