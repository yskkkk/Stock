import type { LiveTradeHolding } from "../api";
import type { ValueInvestBubbleTarget } from "../contexts/ValueInvestBubbleContext";
import type { StockPick } from "../types";

export function stockPickToValueInvestTarget(pick: StockPick): ValueInvestBubbleTarget {
  return {
    symbol: pick.symbol,
    name: pick.name,
    market: pick.market === "us" ? "us" : "kr",
    price: pick.price ?? null,
    currency: pick.currency ?? null,
  };
}

export function holdingToValueInvestTarget(h: LiveTradeHolding): ValueInvestBubbleTarget {
  return {
    symbol: h.symbol,
    name: h.name?.trim() || h.symbol,
    market: h.market === "us" ? "us" : "kr",
    price: h.currentPrice ?? null,
    currency: h.currency ?? null,
  };
}

export function isStockHoldingMarket(
  market: LiveTradeHolding["market"],
): market is "kr" | "us" {
  return market === "kr" || market === "us";
}

export function krFlowRowToValueInvestTarget(row: {
  symbol: string;
  name: string;
  closePrice?: number | null;
}): ValueInvestBubbleTarget {
  return {
    symbol: row.symbol,
    name: row.name,
    market: "kr",
    price: row.closePrice ?? null,
    currency: "KRW",
  };
}
