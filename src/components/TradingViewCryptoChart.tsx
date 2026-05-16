import { memo, useMemo } from "react";
import type { ChartTimeframe } from "../constants/timeframes";
import { ko } from "../i18n/ko";
import { yahooCryptoSymbolToTradingView } from "../lib/tradingviewSymbols";
import TradingViewAdvancedChart from "./TradingViewAdvancedChart";

export interface TradingViewCryptoChartProps {
  yahooSymbol: string;
  timeframe: ChartTimeframe;
  assetName: string;
}

function TradingViewCryptoChartInner({
  yahooSymbol,
  timeframe,
  assetName,
}: TradingViewCryptoChartProps) {
  const tvSymbol = useMemo(
    () => yahooCryptoSymbolToTradingView(yahooSymbol),
    [yahooSymbol],
  );

  return (
    <TradingViewAdvancedChart
      tvSymbol={tvSymbol}
      timeframe={timeframe}
      displayName={assetName}
      ariaLabel={ko.crypto.tvChartAria}
    />
  );
}

export default memo(TradingViewCryptoChartInner);
