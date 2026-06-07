import { describe, expect, it } from "vitest";
import {
  buildVaultDisplayRows,
  countVaultIntersection,
  STOCK_VAULT_SCAN_SOURCES,
} from "./stockVaultFilter";
import type { StockVaultItem } from "../types";

function item(
  partial: Partial<StockVaultItem> & Pick<StockVaultItem, "symbol" | "source">,
): StockVaultItem {
  return {
    id: partial.id ?? `${partial.symbol}-${partial.source}`,
    name: partial.name ?? partial.symbol,
    market: partial.market ?? "kr",
    crosses: partial.crosses,
    crossDate: partial.crossDate,
    scanDate: partial.scanDate ?? "2026-06-08",
    addedAtMs: partial.addedAtMs ?? 1,
    updatedAtMs: partial.updatedAtMs ?? 1,
    favorited: partial.favorited,
    ...partial,
  };
}

describe("stockVaultFilter", () => {
  it("lists single scan source", () => {
    const items = [
      item({ symbol: "A.KS", source: "golden_cross" }),
      item({ symbol: "B.KS", source: "ma_align" }),
    ];
    const rows = buildVaultDisplayRows(items, {
      view: "scan",
      selectedScanSources: ["golden_cross"],
      marketFilter: "all",
      favoriteOnly: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("A.KS");
  });

  it("returns intersection for multiple scan sources", () => {
    const items = [
      item({ symbol: "A.KS", source: "golden_cross", crossDate: "2026-06-08" }),
      item({ symbol: "A.KS", source: "ma_align" }),
      item({ symbol: "B.KS", source: "golden_cross" }),
      item({ symbol: "C.KS", source: "ma_align" }),
    ];
    const rows = buildVaultDisplayRows(items, {
      view: "scan",
      selectedScanSources: ["golden_cross", "ma_align"],
      marketFilter: "all",
      favoriteOnly: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("A.KS");
    expect(rows[0]?.goldenCross).toBeTruthy();
    expect(rows[0]?.maAlign).toBeTruthy();
    expect(rows[0]?.scanSources).toEqual(["golden_cross", "ma_align"]);
  });

  it("counts intersection", () => {
    const items = [
      item({ symbol: "A.KS", source: "golden_cross" }),
      item({ symbol: "A.KS", source: "ma_align" }),
      item({ symbol: "B.KS", source: "golden_cross" }),
    ];
    expect(countVaultIntersection(items, ["golden_cross", "ma_align"])).toBe(1);
  });

  it("exposes scan source registry for future types", () => {
    expect(STOCK_VAULT_SCAN_SOURCES).toContain("golden_cross");
    expect(STOCK_VAULT_SCAN_SOURCES).toContain("ma_align");
  });
});
