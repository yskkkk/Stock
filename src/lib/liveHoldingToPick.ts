import type { LiveTradeHolding } from "../api";
import type { StockPick } from "../types";

export function liveHoldingKey(h: { market: string; symbol: string }): string {
  return `${h.market}:${h.symbol.trim().toUpperCase()}`;
}

export function liveHoldingToStockPick(h: LiveTradeHolding): StockPick {
  const market = h.market === "crypto" ? "kr" : h.market;
  return {
    symbol: h.symbol,
    name: h.name,
    market,
    score: 0,
    signals: [],
    price: h.currentPrice ?? undefined,
    changePercent: h.changePct ?? undefined,
    currency: h.currency,
  };
}
