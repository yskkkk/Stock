import type {
  GoldenCrossHistoryEntry,
  GoldenCrossKind,
  MaAlignHistoryEntry,
  StockVaultFavoriteMeta,
  StockVaultItem,
} from "../types";

function symbolMarketKey(symbol: string, market: "kr" | "us") {
  return `${market}:${symbol.trim().toUpperCase()}`;
}

/** 골든크로스·정배열 이력 날짜 목록(최신순) */
export function mergeScanHistoryDates(
  goldenDates: string[] | undefined,
  maAlignDates: string[] | undefined,
): string[] {
  const set = new Set<string>();
  for (const d of goldenDates ?? []) {
    if (d.trim()) set.add(d.trim());
  }
  for (const d of maAlignDates ?? []) {
    if (d.trim()) set.add(d.trim());
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

type HistoryBuildOpts = {
  favoriteSymbols?: ReadonlySet<string>;
  favoriteMeta?: Record<string, StockVaultFavoriteMeta>;
};

/**
 * 특정 scanDate의 골든크로스·정배열 이력을 보관함 표시용 StockVaultItem[]로 변환.
 * 동일 종목·소스는 atMs가 더 늦은 스캔 기록을 우선한다.
 */
export function buildVaultItemsFromScanHistory(
  scanDate: string,
  goldenEntries: GoldenCrossHistoryEntry[],
  maAlignEntries: MaAlignHistoryEntry[],
  opts: HistoryBuildOpts = {},
): StockVaultItem[] {
  const favorites = opts.favoriteSymbols ?? new Set<string>();
  const meta = opts.favoriteMeta ?? {};

  /** @type {Map<string, { hit: GoldenCrossHistoryEntry["hits"][number]; atMs: number }>} */
  const gcMap = new Map();
  for (const entry of [...goldenEntries].sort((a, b) => b.atMs - a.atMs)) {
    for (const hit of entry.hits) {
      const key = symbolMarketKey(hit.symbol, hit.market);
      if (!gcMap.has(key)) {
        gcMap.set(key, { hit, atMs: entry.atMs });
      }
    }
  }

  /** @type {Map<string, { hit: MaAlignHistoryEntry["hits"][number]; atMs: number }>} */
  const maMap = new Map();
  for (const entry of [...maAlignEntries].sort((a, b) => b.atMs - a.atMs)) {
    for (const hit of entry.hits) {
      const key = symbolMarketKey(hit.symbol, hit.market);
      if (!maMap.has(key)) {
        maMap.set(key, { hit, atMs: entry.atMs });
      }
    }
  }

  const items: StockVaultItem[] = [];

  for (const { hit, atMs } of gcMap.values()) {
    const sym = hit.symbol.trim().toUpperCase();
    const favorited = favorites.has(sym);
    const fm = meta[sym];
    const crosses = (hit.crosses ?? []).filter(
      (c): c is GoldenCrossKind =>
        c === "5>20" || c === "5>60" || c === "5>120",
    );
    items.push({
      id: `hist-gc-${hit.market}-${sym}`,
      symbol: sym,
      name: hit.name,
      market: hit.market,
      source: "golden_cross",
      crosses,
      crossDate: hit.crossDate ?? hit.scanDate ?? scanDate,
      scanDate: hit.scanDate || scanDate,
      addedAtMs: atMs,
      updatedAtMs: atMs,
      favorited,
      favoriteAddedAtMs: fm?.addedAtMs ?? null,
      favoritePrice: fm?.favoritePrice ?? null,
    });
  }

  for (const { hit, atMs } of maMap.values()) {
    const sym = hit.symbol.trim().toUpperCase();
    const favorited = favorites.has(sym);
    const fm = meta[sym];
    items.push({
      id: `hist-ma-${hit.market}-${sym}`,
      symbol: sym,
      name: hit.name,
      market: hit.market,
      source: "ma_align",
      scanDate: hit.scanDate || scanDate,
      addedAtMs: atMs,
      updatedAtMs: atMs,
      favorited,
      favoriteAddedAtMs: fm?.addedAtMs ?? null,
      favoritePrice: fm?.favoritePrice ?? null,
    });
  }

  return items;
}
