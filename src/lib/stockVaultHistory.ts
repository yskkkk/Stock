import type {
  GoldenCrossHistoryEntry,
  GoldenCrossKind,
  Ma120NearHistoryEntry,
  MaAlignHistoryEntry,
  StockVaultFavoriteMeta,
  StockVaultItem,
  StockVaultTimeframe,
} from "../types";
import { normalizeStockVaultTimeframe } from "./stockVaultTimeframe";

function symbolMarketKey(symbol: string, market: "kr" | "us") {
  return `${market}:${symbol.trim().toUpperCase()}`;
}

/** 골든크로스·정배열·120선 근처 이력 날짜 목록(최신순) */
export function mergeScanHistoryDates(
  goldenDates: string[] | undefined,
  maAlignDates: string[] | undefined,
  ma120NearDates?: string[] | undefined,
): string[] {
  const set = new Set<string>();
  for (const d of goldenDates ?? []) {
    if (d.trim()) set.add(d.trim());
  }
  for (const d of maAlignDates ?? []) {
    if (d.trim()) set.add(d.trim());
  }
  for (const d of ma120NearDates ?? []) {
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
  ma120NearEntries: Ma120NearHistoryEntry[] = [],
  opts: HistoryBuildOpts & { timeframe?: StockVaultTimeframe } = {},
): StockVaultItem[] {
  const favorites = opts.favoriteSymbols ?? new Set<string>();
  const meta = opts.favoriteMeta ?? {};
  const timeframe = normalizeStockVaultTimeframe(opts.timeframe);

  /** @type {Map<string, { hit: GoldenCrossHistoryEntry["hits"][number]; atMs: number }>} */
  const gcMap = new Map();
  for (const entry of [...goldenEntries]
    .filter((e) => normalizeStockVaultTimeframe(e.timeframe) === timeframe)
    .sort((a, b) => b.atMs - a.atMs)) {
    for (const hit of entry.hits) {
      const key = symbolMarketKey(hit.symbol, hit.market);
      if (!gcMap.has(key)) {
        gcMap.set(key, { hit, atMs: entry.atMs });
      }
    }
  }

  /** @type {Map<string, { hit: MaAlignHistoryEntry["hits"][number]; atMs: number }>} */
  const maMap = new Map();
  for (const entry of [...maAlignEntries]
    .filter((e) => normalizeStockVaultTimeframe(e.timeframe) === timeframe)
    .sort((a, b) => b.atMs - a.atMs)) {
    for (const hit of entry.hits) {
      const key = symbolMarketKey(hit.symbol, hit.market);
      if (!maMap.has(key)) {
        maMap.set(key, { hit, atMs: entry.atMs });
      }
    }
  }

  /** @type {Map<string, { hit: Ma120NearHistoryEntry["hits"][number]; atMs: number }>} */
  const ma120Map = new Map();
  if (timeframe === "1d") {
    for (const entry of [...ma120NearEntries].sort((a, b) => b.atMs - a.atMs)) {
      for (const hit of entry.hits) {
        const key = symbolMarketKey(hit.symbol, hit.market);
        if (!ma120Map.has(key)) {
          ma120Map.set(key, { hit, atMs: entry.atMs });
        }
      }
    }
  }

  const items: StockVaultItem[] = [];

  for (const { hit, atMs } of gcMap.values()) {
    const sym = hit.symbol.trim().toUpperCase();
    const favorited = favorites.has(sym);
    const fm = meta[sym];
    const crosses = (hit.crosses ?? []).filter(
      (c: string): c is GoldenCrossKind =>
        c === "5>20" ||
        c === "5<20" ||
        c === "20>120" ||
        c === "20<120" ||
        c === "5>60" ||
        c === "5>120",
    );
    items.push({
      id: `hist-gc-${hit.market}-${sym}`,
      symbol: sym,
      name: hit.name,
      market: hit.market,
      source: "golden_cross",
      timeframe,
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
      timeframe,
      scanDate: hit.scanDate || scanDate,
      addedAtMs: atMs,
      updatedAtMs: atMs,
      favorited,
      favoriteAddedAtMs: fm?.addedAtMs ?? null,
      favoritePrice: fm?.favoritePrice ?? null,
    });
  }

  for (const { hit, atMs } of ma120Map.values()) {
    const sym = hit.symbol.trim().toUpperCase();
    const favorited = favorites.has(sym);
    const fm = meta[sym];
    items.push({
      id: `hist-ma120-${hit.market}-${sym}`,
      symbol: sym,
      name: hit.name,
      market: hit.market,
      source: "ma120_near",
      timeframe: "1d",
      scanDate: hit.scanDate || scanDate,
      ma120: hit.ma120,
      distancePct: hit.distancePct,
      ma120Approach: hit.ma120Approach,
      ma120Side:
        hit.ma120Side ??
        (hit.ma120Approach === "from_below"
          ? "below"
          : hit.ma120Approach === "from_above"
            ? "above"
            : undefined),
      addedAtMs: atMs,
      updatedAtMs: atMs,
      favorited,
      favoriteAddedAtMs: fm?.addedAtMs ?? null,
      favoritePrice: fm?.favoritePrice ?? null,
    });
  }

  return items;
}

/** 일·주봉 탐색 결과를 날짜 스냅샷용으로 합친다 */
export function buildFullSnapshotFromScanHistory(
  scanDate: string,
  goldenEntries: GoldenCrossHistoryEntry[],
  maAlignEntries: MaAlignHistoryEntry[],
  ma120NearEntries: Ma120NearHistoryEntry[] = [],
  opts: HistoryBuildOpts = {},
): StockVaultItem[] {
  const daily = buildVaultItemsFromScanHistory(
    scanDate,
    goldenEntries,
    maAlignEntries,
    ma120NearEntries,
    { ...opts, timeframe: "1d" },
  );
  const weekly = buildVaultItemsFromScanHistory(
    scanDate,
    goldenEntries,
    maAlignEntries,
    [],
    { ...opts, timeframe: "1wk" },
  );
  const map = new Map<string, StockVaultItem>();
  for (const it of [...daily, ...weekly]) {
    map.set(`${it.source}:${it.market}:${it.symbol.trim().toUpperCase()}`, it);
  }
  return [...map.values()];
}
