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
export function yahooStockSymbolToTradingView(
  yahoo: string,
  market: Market,
): string {
  const u = yahoo.trim().toUpperCase();
  if (market === "kr") {
    const ks = u.match(/^(\d{1,6})\.KS$/);
    const kq = u.match(/^(\d{1,6})\.KQ$/);
    const raw = ks?.[1] ?? kq?.[1];
    if (raw) return `KRX:${raw.padStart(6, "0")}`;
  }
  const base = u.includes(".") ? u.slice(0, Math.max(0, u.indexOf("."))) : u;
  const ticker = base.replace(/\./g, "-");
  if (!ticker) return "NASDAQ:AAPL";
  return `NASDAQ:${ticker}`;
}
