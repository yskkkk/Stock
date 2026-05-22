import type { PicksDailyHistoryQuotesMap } from "../api";
import type { StockSearchQuoteRow } from "../types";

export function mergeQuotesIntoStockSearchRows(
  rows: StockSearchQuoteRow[],
  quotes: PicksDailyHistoryQuotesMap,
): StockSearchQuoteRow[] {
  return rows.map((row) => {
    const sym = row.symbol.trim().toUpperCase();
    const q = quotes[sym];
    if (q?.price == null || !Number.isFinite(q.price) || q.price <= 0) {
      return row;
    }
    return {
      ...row,
      price: q.price,
      changePercent:
        q.changePercent != null && Number.isFinite(q.changePercent)
          ? q.changePercent
          : row.changePercent,
      currency: q.currency ?? row.currency,
    };
  });
}
