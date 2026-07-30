import { describe, expect, it } from "vitest";
import {
  buildVaultActiveFilterLabels,
  buildVaultDisplayRows,
  countVaultIntersection,
  visibleStockVaultScanSources,
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

  it("returns empty list when no scan source selected", () => {
    const items = [
      item({ symbol: "A.KS", source: "golden_cross" }),
      item({ symbol: "B.KS", source: "ma_align" }),
    ];
    const rows = buildVaultDisplayRows(items, {
      selectedScanSources: [],
      marketFilter: "all",
      favoriteOnly: false,
    });
    expect(rows).toHaveLength(0);
  });

  it("lists bottom_candle scan source", () => {
    const items = [
      item({ symbol: "A.KS", source: "bottom_candle", bottomTag: "저점" }),
      item({ symbol: "B.KS", source: "golden_cross" }),
    ];
    const rows = buildVaultDisplayRows(items, {
      selectedScanSources: ["bottom_candle"],
      marketFilter: "all",
      favoriteOnly: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("A.KS");
    expect(rows[0]?.bottomCandle).toBeTruthy();
  });

  it("lists favorite-only items when favorite filter is on", () => {
    const items = [
      item({ symbol: "A.KS", source: "favorite", favorited: true }),
      item({ symbol: "B.KS", source: "golden_cross" }),
    ];
    const rows = buildVaultDisplayRows(items, {
      selectedScanSources: ["golden_cross"],
      marketFilter: "all",
      favoriteOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("A.KS");
    expect(rows[0]?.favorite).toBeTruthy();
  });

  it("favorite filter — other timeframe favorited scan still shows row", () => {
    const items = [
      item({
        symbol: "A.KS",
        source: "golden_cross",
        timeframe: "1d",
        favorited: true,
      }),
    ];
    const rows = buildVaultDisplayRows(items, {
      selectedScanSources: [],
      marketFilter: "all",
      favoriteOnly: true,
      timeframeFilter: "1wk",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("A.KS");
    expect(rows[0]?.favorite).toBeTruthy();
  });

  it("groupByScanDate — 동일 종목·다른 탐색 일자는 행 분리", () => {
    const items = [
      item({
        id: "gc-1",
        symbol: "A.KS",
        source: "golden_cross",
        scanDate: "2026-06-10",
      }),
      item({
        id: "gc-2",
        symbol: "A.KS",
        source: "golden_cross",
        scanDate: "2026-06-08",
      }),
    ];
    const rows = buildVaultDisplayRows(items, {
      selectedScanSources: ["golden_cross"],
      marketFilter: "all",
      favoriteOnly: false,
      groupByScanDate: true,
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("주봉 탭 — 바닥캔들·매집봉·저점기울기 필터 표시", () => {
    const weekly = visibleStockVaultScanSources("1wk");
    expect(weekly).toContain("bottom_candle");
    expect(weekly).toContain("book_accum");
    expect(weekly).toContain("low_slope_flip");
    expect(weekly).not.toContain("ma120_near");
  });

  it("일봉 탭 — 저점기울기 필터 숨김", () => {
    const daily = visibleStockVaultScanSources("1d");
    expect(daily).not.toContain("low_slope_flip");
  });

  it("buildVaultActiveFilterLabels — 복합 필터 라벨", () => {
    const labels = buildVaultActiveFilterLabels({
      selectedScanDate: "2026-06-08",
      filter: "favorite",
      selectedScanSources: ["golden_cross", "ma_align"],
      timeframeFilter: "1wk",
      marketFilter: "kr",
      industryFilter: "반도체",
      ma120ApproachFilter: null,
      scanSourceLabel: (s) =>
        s === "golden_cross" ? "골든크로스" : s === "ma_align" ? "정배열" : s,
      labels: {
        historyAll: "전체",
        scanDatePrefix: "일자",
        filterFavorite: "즐겨찾기",
        marketKr: "국내",
        marketUs: "미국",
        ma120FromBelow: "하단접근",
        ma120FromAbove: "상단접근",
        timeframeWeekly: "주봉",
      },
    });
    expect(labels).toEqual([
      "일자 2026-06-08",
      "즐겨찾기",
      "골든크로스+정배열",
      "주봉",
      "국내",
      "반도체",
    ]);
  });

  it("buildVaultActiveFilterLabels — 기본값이면 빈 배열", () => {
    const labels = buildVaultActiveFilterLabels({
      selectedScanDate: null,
      filter: "all",
      selectedScanSources: ["golden_cross"],
      timeframeFilter: "1d",
      marketFilter: "all",
      industryFilter: "all",
      ma120ApproachFilter: null,
      scanSourceLabel: () => "골든크로스",
      labels: {
        historyAll: "전체",
        scanDatePrefix: "일자",
        filterFavorite: "즐겨찾기",
        marketKr: "국내",
        marketUs: "미국",
        ma120FromBelow: "하단접근",
        ma120FromAbove: "상단접근",
        timeframeWeekly: "주봉",
      },
    });
    expect(labels).toEqual([]);
  });
});
