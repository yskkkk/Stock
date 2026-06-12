import { describe, expect, it } from "vitest";
import {
  defaultStockVaultTabUi,
  peekStockVaultTabUi,
  saveStockVaultTabUi,
} from "./stockVaultTabSession";

describe("stockVaultTabSession", () => {
  it("restores saved filters from memory", () => {
    saveStockVaultTabUi({
      filter: "favorite",
      selectedScanSources: ["golden_cross", "ma_align"],
      timeframeFilter: "1wk",
      marketFilter: "kr",
      industryFilter: "반도체",
      selectedScanDate: "2026-06-10",
    });
    const ui = peekStockVaultTabUi();
    expect(ui?.filter).toBe("favorite");
    expect(ui?.selectedScanSources).toEqual(["golden_cross", "ma_align"]);
    expect(ui?.timeframeFilter).toBe("1wk");
    expect(ui?.marketFilter).toBe("kr");
    expect(ui?.industryFilter).toBe("반도체");
    expect(ui?.selectedScanDate).toBe("2026-06-10");
  });

  it("falls back to defaults for invalid values", () => {
    saveStockVaultTabUi({
      ...defaultStockVaultTabUi(),
      selectedScanSources: [],
      marketFilter: "jp" as "kr",
      selectedScanDate: "  ",
    });
    const ui = peekStockVaultTabUi();
    expect(ui?.selectedScanSources).toEqual(["golden_cross"]);
    expect(ui?.marketFilter).toBe("all");
    expect(ui?.selectedScanDate).toBeNull();
  });

  it("keeps only one ma120 approach filter", () => {
    saveStockVaultTabUi({
      ...defaultStockVaultTabUi(),
      ma120ApproachFilter: ["from_below", "from_above"],
    });
    expect(peekStockVaultTabUi()?.ma120ApproachFilter).toBe("from_above");
    saveStockVaultTabUi({
      ...defaultStockVaultTabUi(),
      ma120ApproachFilter: "from_below",
    });
    expect(peekStockVaultTabUi()?.ma120ApproachFilter).toBe("from_below");
  });
});
