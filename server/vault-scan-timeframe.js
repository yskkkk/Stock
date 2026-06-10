/** 종목보관함 자동탐색 봉 구간 */

/** @typedef {"1d"|"1wk"} VaultScanTimeframe */

export const VAULT_SCAN_TIMEFRAMES = /** @type {const} */ (["1d", "1wk"]);
export const VAULT_SCAN_TIMEFRAME_DEFAULT = /** @type {const} */ ("1d");

/** @param {unknown} value */
export function normalizeVaultScanTimeframe(value) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "1wk" || v === "weekly" || v === "week" || v === "w") return "1wk";
  return "1d";
}

/** @param {VaultScanTimeframe} timeframe */
export function vaultScanChartTimeframe(timeframe) {
  return normalizeVaultScanTimeframe(timeframe) === "1wk" ? "1wk" : "1d";
}

/** @param {VaultScanTimeframe} timeframe */
export function maxBarAgeDaysForVaultScan(timeframe) {
  const tf = normalizeVaultScanTimeframe(timeframe);
  if (tf === "1wk") {
    const n = Number(process.env.STOCK_GOLDEN_CROSS_WEEKLY_MAX_BAR_AGE_DAYS ?? 28);
    return Number.isFinite(n) && n >= 7 ? Math.min(n, 120) : 28;
  }
  const n = Number(process.env.STOCK_GOLDEN_CROSS_MAX_BAR_AGE_DAYS ?? 21);
  return Number.isFinite(n) && n >= 5 ? Math.min(n, 90) : 21;
}

/** @param {"kr"|"us"} market @param {VaultScanTimeframe} timeframe */
export function vaultScanStateDateField(market, timeframe) {
  const tf = normalizeVaultScanTimeframe(timeframe);
  if (market === "kr") return tf === "1wk" ? "krWeeklyLastScanDate" : "krLastScanDate";
  return tf === "1wk" ? "usWeeklyLastScanDate" : "usLastScanDate";
}
