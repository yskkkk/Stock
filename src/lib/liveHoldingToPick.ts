import type { LiveTradeHolding } from "../api";
import type { StockPick } from "../types";

export function liveHoldingKey(h: { market: string; symbol: string }): string {
  return `${h.market}:${h.symbol.trim().toUpperCase()}`;
}

export function liveHoldingToStockPick(h: LiveTradeHolding): StockPick {
  return {
    symbol: h.symbol,
    name: h.name,
    market: h.market,
    score: 0,
    signals: [],
    price: h.currentPrice ?? undefined,
    changePercent: h.changePct ?? undefined,
    currency: h.currency,
  };
}
