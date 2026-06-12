import { describe, expect, it, beforeEach } from "vitest";
import {
  extractScanItemsFromVault,
  mergeScanItemsIntoSnapshot,
  peekLocalScanSnapshot,
  saveLocalScanSnapshot,
} from "./stockVaultLocalSnapshot";
import type { StockVaultItem } from "../types";

const gc = (
  symbol: string,
  addedAtMs: number,
  market: "kr" | "us" = "kr",
): StockVaultItem => ({
  id: `gc-${symbol}`,
  symbol,
  name: symbol,
  market,
  source: "golden_cross",
  timeframe: "1d",
  crosses: ["5>20"],
  scanDate: "2026-06-13",
  addedAtMs,
  updatedAtMs: addedAtMs,
  favorited: false,
  favoriteAddedAtMs: null,
  favoritePrice: null,
});

describe("stockVaultLocalSnapshot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("merge keeps prior symbols and updates overlapping ones", () => {
    const merged = mergeScanItemsIntoSnapshot(
      [gc("AAA.KS", 100)],
      [gc("BBB.KS", 200), gc("AAA.KS", 300, "kr")],
    );
    expect(merged.map((it) => it.symbol).sort()).toEqual(["AAA.KS", "BBB.KS"]);
    expect(merged.find((it) => it.symbol === "AAA.KS")?.addedAtMs).toBe(300);
  });

  it("persists by date in localStorage", () => {
    saveLocalScanSnapshot("2026-06-13", [gc("AAA.KS", 100)]);
    expect(peekLocalScanSnapshot("2026-06-13")?.[0]?.symbol).toBe("AAA.KS");
  });

  it("extracts scan items from vault payload", () => {
    const rows = extractScanItemsFromVault([
      gc("AAA.KS", 1),
      {
        id: "fav",
        symbol: "BBB.KS",
        name: "B",
        market: "kr",
        source: "favorite",
        timeframe: "1d",
        scanDate: "2026-06-13",
        addedAtMs: 1,
        updatedAtMs: 1,
        favorited: true,
        favoriteAddedAtMs: 1,
        favoritePrice: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("AAA.KS");
  });
});
