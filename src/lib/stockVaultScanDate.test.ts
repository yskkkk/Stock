import { describe, expect, it } from "vitest";
import {
  isStockVaultAllScanDates,
  isStockVaultLatestScanDate,
  isStockVaultSpecificScanDate,
  shouldPersistStockVaultSnapshot,
  STOCK_VAULT_SCAN_DATE_ALL,
  stockVaultSnapshotPersistDate,
} from "./stockVaultScanDate";

describe("stockVaultScanDate", () => {
  it("전체·최신·특정 일자 구분", () => {
    expect(isStockVaultLatestScanDate(null)).toBe(true);
    expect(isStockVaultAllScanDates(STOCK_VAULT_SCAN_DATE_ALL)).toBe(true);
    expect(isStockVaultSpecificScanDate("2026-06-17")).toBe(true);
    expect(isStockVaultSpecificScanDate(STOCK_VAULT_SCAN_DATE_ALL)).toBe(false);
  });

  it("스냅샷 저장 — 전체 보기는 제외", () => {
    expect(shouldPersistStockVaultSnapshot(null)).toBe(true);
    expect(shouldPersistStockVaultSnapshot("2026-06-17")).toBe(true);
    expect(shouldPersistStockVaultSnapshot(STOCK_VAULT_SCAN_DATE_ALL)).toBe(false);
    expect(stockVaultSnapshotPersistDate(null, "2026-06-17")).toBe("2026-06-17");
    expect(stockVaultSnapshotPersistDate("2026-06-10", "2026-06-17")).toBe(
      "2026-06-10",
    );
  });
});
