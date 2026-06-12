import type { StockPick } from "../types";
import type { ValueInvestBubbleTarget } from "../contexts/ValueInvestBubbleContext";

export function stockPickToValueInvestTarget(pick: StockPick): ValueInvestBubbleTarget {
  return {
    symbol: pick.symbol,
    name: pick.name,
    market: pick.market === "us" ? "us" : "kr",
    price: pick.price ?? null,
    currency: pick.currency ?? null,
  };
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
