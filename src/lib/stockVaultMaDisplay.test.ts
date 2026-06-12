import { describe, expect, it } from "vitest";
import {
  enrichMa120ItemSide,
  listMa120SymbolsNeedingQuotes,
  resolveMa120Approach,
} from "./stockVaultMaDisplay";
import type { StockVaultItem } from "../types";

const ma120Item = (overrides: Partial<StockVaultItem> = {}): StockVaultItem => ({
  id: "x",
  symbol: "AAPL",
  name: "Apple",
  market: "us",
  source: "ma120_near",
  timeframe: "1d",
  scanDate: "2026-06-13",
  addedAtMs: 1,
  updatedAtMs: 1,
  ...overrides,
});

describe("resolveMa120Approach", () => {
  it("uses stored approach when not flat", () => {
    expect(resolveMa120Approach({ ma120Approach: "from_below" })).toBe("from_below");
  });

  it("ignores stored flat and falls back to ma120Side", () => {
    expect(
      resolveMa120Approach({ ma120Approach: "flat", ma120Side: "above" }),
    ).toBe("from_above");
  });

  it("derives from current price vs ma120", () => {
    expect(
      resolveMa120Approach({ ma120Approach: "flat", ma120: 100 }, null, 97),
    ).toBe("from_below");
    expect(
      resolveMa120Approach({ ma120Approach: "flat", ma120: 100 }, null, 103),
    ).toBe("from_above");
  });

  it("uses chart insight side when within proximity", () => {
    expect(
      resolveMa120Approach(
        { ma120: 100 },
        { daily: { near: [{ period: 120, side: "below", approach: "flat" }] } },
      ),
    ).toBe("from_below");
  });
});

describe("listMa120SymbolsNeedingQuotes", () => {
  it("skips items with stored side", () => {
    const items = [ma120Item({ ma120Side: "below" })];
    expect(listMa120SymbolsNeedingQuotes(items, {}, {})).toEqual([]);
  });

  it("requests quote when only ma120 is stored", () => {
    const items = [ma120Item({ ma120: 100 })];
    expect(listMa120SymbolsNeedingQuotes(items, {}, {})).toEqual(["AAPL"]);
  });

  it("skips when quote and ma120 are enough", () => {
    const items = [ma120Item({ ma120: 100 })];
    expect(listMa120SymbolsNeedingQuotes(items, { AAPL: { price: 98 } }, {})).toEqual(
      [],
    );
  });
});

describe("enrichMa120ItemSide", () => {
  it("derives side from current price", () => {
    expect(enrichMa120ItemSide(ma120Item({ ma120: 100 }), 103).ma120Side).toBe(
      "above",
    );
  });
});
