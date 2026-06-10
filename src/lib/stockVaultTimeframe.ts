import type { StockVaultTimeframe } from "../types";

export const STOCK_VAULT_TIMEFRAMES: readonly StockVaultTimeframe[] = [
  "1d",
  "1wk",
];

export function normalizeStockVaultTimeframe(
  value: unknown,
): StockVaultTimeframe {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "1wk" || v === "weekly" || v === "week" || v === "w") {
    return "1wk";
  }
  return "1d";
}

export function stockVaultTimeframeLabel(tf: StockVaultTimeframe): string {
  return tf === "1wk" ? "주봉" : "일봉";
}
