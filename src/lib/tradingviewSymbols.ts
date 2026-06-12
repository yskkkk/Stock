import type { ChartTimeframe } from "../constants/timeframes";
import type { Market } from "../types";

/** 앱 티커 → TradingView (USDT 현물, Binance) */
const YAHOO_CRYPTO_TO_TV: Record<string, string> = {
  "BTC-USDT": "BINANCE:BTCUSDT",
  "ETH-USDT": "BINANCE:ETHUSDT",
  "SOL-USDT": "BINANCE:SOLUSDT",
  "BTC-USD": "BINANCE:BTCUSDT",
  "ETH-USD": "BINANCE:ETHUSDT",
  "SOL-USD": "BINANCE:SOLUSDT",
};

const TF_TO_INTERVAL: Record<ChartTimeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
};

export function chartTimeframeToTradingViewInterval(
  tf: ChartTimeframe,
): string {
  return TF_TO_INTERVAL[tf] ?? "D";
}

export function yahooCryptoSymbolToTradingView(yahoo: string): string {
  const key = yahoo.trim().toUpperCase();
  if (YAHOO_CRYPTO_TO_TV[key]) return YAHOO_CRYPTO_TO_TV[key]!;
  const m = /^([A-Z0-9]+)-USDT$/.exec(key);
  if (m) return `BINANCE:${m[1]}USDT`;
  return "BINANCE:BTCUSDT";
}

/** Yahoo 종목 티커 → TradingView Advanced Chart 심볼 (근사 매핑) */
export function yahooExchangeCodeToTradingViewPrefix(
  code?: string | null,
): "NASDAQ" | "NYSE" | "AMEX" | null {
  const ex = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!ex) return null;
  if (ex === "NMS" || ex === "NGM" || ex === "NCM" || ex.includes("NASDAQ")) {
    return "NASDAQ";
  }
  if (ex === "NYQ" || ex === "NYS" || ex.includes("NYSE") || ex.includes("NEW YORK")) {
    return "NYSE";
  }
  if (ex === "ASE" || ex === "AMX" || ex.includes("AMEX") || ex.includes("AMERICAN")) {
    return "AMEX";
  }
  return null;
}

export function exchangeToTradingViewPrefix(
  exchange?: string | null,
): "NASDAQ" | "NYSE" | "AMEX" | null {
  const ex = String(exchange ?? "")
    .trim()
    .toUpperCase();
  if (!ex) return null;
  if (ex.includes("NASDAQ")) return "NASDAQ";
  if (ex.includes("NYSE") || ex.includes("NEW YORK")) return "NYSE";
  if (ex.includes("AMEX") || ex.includes("AMERICAN")) return "AMEX";
  return yahooExchangeCodeToTradingViewPrefix(ex);
}

/** Yahoo US 티커 → TradingView 티커 (BRK-B → BRK.B 등 클래스주) */
export function yahooUsTickerToTradingViewTicker(ticker: string): string {
  const u = ticker.trim().toUpperCase();
  if (!u) return u;
  if (/^[A-Z0-9]+-[A-Z]$/.test(u)) {
    return u.replace(/-([A-Z])$/, ".$1");
  }
  if (u.includes(".")) return u;
  return u;
}

/** Yahoo 종목 티커 → TradingView Advanced Chart 심볼 (근사 매핑) */
export function yahooStockSymbolToTradingView(
  yahoo: string,
  market: Market,
  exchange?: string | null,
): string {
  const u = yahoo.trim().toUpperCase();
  if (market === "kr") {
    const ks = u.match(/^(\d{1,6})\.KS$/);
    const kq = u.match(/^(\d{1,6})\.KQ$/);
    const raw = ks?.[1] ?? kq?.[1];
    if (raw) return `KRX:${raw.padStart(6, "0")}`;
  }
  const ticker = yahooUsTickerToTradingViewTicker(u);
  if (!ticker) return "NASDAQ:AAPL";
  const prefix = exchangeToTradingViewPrefix(exchange) ?? "NASDAQ";
  return `${prefix}:${ticker}`;
}

/** TradingView 재무 탭 URL (심볼 슬러그) */
export function tradingViewFinancialsUrl(tvSymbol: string): string {
  const slug = tvSymbol.trim().replace(":", "-");
  return `https://www.tradingview.com/symbols/${slug}/financials-overview/?utm_source=ystock&utm_medium=financials_tab`;
}

/** TradingView 차트 페이지 URL (일봉 기본) */
export function tradingViewChartUrl(
  tvSymbol: string,
  timeframe: ChartTimeframe = "1d",
): string {
  const symbol = tvSymbol.trim();
  const interval = chartTimeframeToTradingViewInterval(timeframe);
  const q = new URLSearchParams({
    symbol,
    interval,
    utm_source: "ystock",
    utm_medium: "stock_vault",
  });
  return `https://www.tradingview.com/chart/?${q.toString()}`;
}
