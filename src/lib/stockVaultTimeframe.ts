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

export function stockVaultTimeframeRowClass(tf: StockVaultTimeframe): string {
  return normalizeStockVaultTimeframe(tf) === "1wk"
    ? "stock-vault-tab__row--tf-wk"
    : "stock-vault-tab__row--tf-d";
}

export function stockVaultTimeframeBadgeClass(tf: StockVaultTimeframe): string {
  return normalizeStockVaultTimeframe(tf) === "1wk"
    ? "stock-vault-tab__timeframe stock-vault-tab__timeframe--wk"
    : "stock-vault-tab__timeframe stock-vault-tab__timeframe--d";
}
