/** 탐색 일자 드롭다운 — 전체 일자 합산 보기 */
export const STOCK_VAULT_SCAN_DATE_ALL = "__all__";

export function isStockVaultAllScanDates(
  date: string | null | undefined,
): boolean {
  return date === STOCK_VAULT_SCAN_DATE_ALL;
}

export function isStockVaultLatestScanDate(
  date: string | null | undefined,
): boolean {
  return date == null;
}

export function isStockVaultSpecificScanDate(
  date: string | null | undefined,
): boolean {
  return date != null && date !== STOCK_VAULT_SCAN_DATE_ALL;
}

/** 로컬 스냅샷 저장 일자 — 최신이면 today, 특정 일자면 그 날짜 */
export function stockVaultSnapshotPersistDate(
  date: string | null | undefined,
  todayYmd: string,
): string {
  return isStockVaultSpecificScanDate(date) ? date! : todayYmd;
}

export function shouldPersistStockVaultSnapshot(
  date: string | null | undefined,
): boolean {
  return !isStockVaultAllScanDates(date);
}
