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
        id: "bc",
        symbol: "CCC.KS",
        name: "C",
        market: "kr",
        source: "bottom_candle",
        timeframe: "1d",
        scanDate: "2026-06-13",
        bottomTag: "바닥·전형",
        bottomScore: 72,
        addedAtMs: 1,
        updatedAtMs: 1,
        favorited: false,
        favoriteAddedAtMs: null,
        favoritePrice: null,
      },
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
    expect(rows.map((it) => it.symbol).sort()).toEqual(["AAA.KS", "CCC.KS"]);
  });

  it("merge keeps daily and weekly rows for same symbol", () => {
    const daily: StockVaultItem = {
      ...gc("AAA.KS", 100),
      source: "bottom_candle",
      timeframe: "1d",
    };
    const weekly: StockVaultItem = {
      ...gc("AAA.KS", 200),
      source: "bottom_candle",
      timeframe: "1wk",
    };
    const merged = mergeScanItemsIntoSnapshot([daily], [weekly]);
    expect(merged).toHaveLength(2);
  });
});
