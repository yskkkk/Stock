import { App } from "@capacitor/app";
import type { ChartTimeframe } from "../constants/timeframes";
import { isMobilePhoneEnv } from "./isMobilePhone";
import { isNativeApp } from "./isNativeApp";
import {
  chartTimeframeToTradingViewInterval,
  tradingViewChartUrl,
} from "./tradingviewSymbols";

const INTERVAL_TO_TF: Record<string, ChartTimeframe> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "60": "1h",
  "240": "4h",
  D: "1d",
};

function intervalToTimeframe(interval?: string | null): ChartTimeframe {
  const key = String(interval ?? "D").trim();
  return INTERVAL_TO_TF[key] ?? "1d";
}

function parseTvChartWebUrl(
  webUrl: string,
): { tvSymbol: string; timeframe: ChartTimeframe } | null {
  try {
    const u = new URL(webUrl);
    const symbol = u.searchParams.get("symbol")?.trim();
    if (!symbol) return null;
    return {
      tvSymbol: symbol,
      timeframe: intervalToTimeframe(u.searchParams.get("interval")),
    };
  } catch {
    return null;
  }
}

async function launchTradingViewUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    try {
      await App.openUrl({ url });
      return;
    } catch {
      /* fallback below */
    }
  }
  if (isMobilePhoneEnv()) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** 휴대폰·네이티브 — 시스템이 TradingView 앱(설치 시) 또는 브라우저로 연다 */
export async function openTradingViewChart(
  tvSymbol: string,
  timeframe: ChartTimeframe = "1d",
): Promise<void> {
  const symbol = tvSymbol.trim();
  if (!symbol) return;
  const url = tradingViewChartUrl(symbol, timeframe);
  await launchTradingViewUrl(url);
}

/** tradingViewChartUrl() 결과 — 말풍선·외부 링크용 */
export async function openTradingViewChartUrl(webUrl: string): Promise<void> {
  const parsed = parseTvChartWebUrl(webUrl);
  if (parsed) {
    await openTradingViewChart(parsed.tvSymbol, parsed.timeframe);
    return;
  }
  await launchTradingViewUrl(webUrl);
}

export { chartTimeframeToTradingViewInterval };
