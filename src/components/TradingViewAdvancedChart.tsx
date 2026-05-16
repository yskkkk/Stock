import { memo, useEffect, useRef } from "react";
import type { ChartTimeframe } from "../constants/timeframes";
import { ko } from "../i18n/ko";
import { chartTimeframeToTradingViewInterval } from "../lib/tradingviewSymbols";

const TV_ADVANCED_EMBED_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

export interface TradingViewAdvancedChartProps {
  tvSymbol: string;
  timeframe: ChartTimeframe;
  /** 저작권 링크·접근성용 표시 이름 */
  displayName: string;
  ariaLabel: string;
}

function clearTradingViewEmbed(root: HTMLElement) {
  root
    .querySelectorAll(`script[src="${TV_ADVANCED_EMBED_SRC}"]`)
    .forEach((el) => el.remove());
  const w = root.querySelector(".tradingview-widget-container__widget");
  if (w) w.innerHTML = "";
}

function TradingViewAdvancedChartInner({
  tvSymbol,
  timeframe,
  displayName,
  ariaLabel,
}: TradingViewAdvancedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const symSlug = tvSymbol.replace(":", "-");

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    clearTradingViewEmbed(root);

    const interval = chartTimeframeToTradingViewInterval(timeframe);

    const script = document.createElement("script");
    script.src = TV_ADVANCED_EMBED_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: "Asia/Seoul",
      theme: "dark",
      style: "1",
      locale: "kr",
      calendar: false,
      withdateranges: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      allow_symbol_change: true,
      support_host: "https://www.tradingview.com",
      backgroundColor: "rgba(10, 14, 19, 1)",
    });

    root.appendChild(script);

    return () => {
      clearTradingViewEmbed(root);
    };
  }, [tvSymbol, timeframe]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container tradingview-embed-mount"
      style={{ height: "100%", width: "100%" }}
      role="region"
      aria-label={ariaLabel}
    >
      <div
        className="tradingview-widget-container__widget"
        style={{ height: "calc(100% - 32px)", width: "100%" }}
      />
      <div className="tradingview-widget-copyright">
        <a
          href={`https://www.tradingview.com/symbols/${symSlug}/?utm_source=localhost&utm_medium=widget_new&utm_campaign=advanced-chart`}
          rel="noopener nofollow noreferrer"
          target="_blank"
        >
          <span className="blue-text">{displayName}</span>
        </a>
        <span className="trademark">{ko.crypto.tvCopyrightSuffix}</span>
      </div>
    </div>
  );
}

export default memo(TradingViewAdvancedChartInner);
