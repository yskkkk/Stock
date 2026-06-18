import { sortGoldenCrossItems } from "./goldenCrossRecency";
import { normalizeStockVaultTimeframe } from "./stockVaultTimeframe";
import type {
  StockVaultItem,
  StockVaultScanSource,
  StockVaultTimeframe,
} from "../types";

/** 자동 탐색 조건 — 새 유형 추가 시 여기만 확장 */
export const STOCK_VAULT_SCAN_SOURCES: readonly StockVaultScanSource[] = [
  "golden_cross",
  "ma_align",
  "ma120_near",
  "low_slope_flip",
  "bottom_candle",
  "book_accum",
];

export type VaultDisplayRow = {
  key: string;
  symbol: string;
  name: string;
  market: "kr" | "us";
  timeframe: StockVaultTimeframe;
  favorited: boolean;
  updatedAtMs: number;
  scanSources: StockVaultScanSource[];
  goldenCross?: StockVaultItem;
  maAlign?: StockVaultItem;
  ma120Near?: StockVaultItem;
  lowSlopeFlip?: StockVaultItem;
  bottomCandle?: StockVaultItem;
  bookAccum?: StockVaultItem;
  favorite?: StockVaultItem;
};

function symbolMarketTimeframeKey(
  item: Pick<StockVaultItem, "symbol" | "market" | "timeframe">,
) {
  return `${item.market}:${item.symbol.trim().toUpperCase()}:${normalizeStockVaultTimeframe(item.timeframe)}`;
}

function vaultDisplayRowKey(
  item: StockVaultItem,
  groupByScanDate: boolean,
) {
  const base = symbolMarketTimeframeKey(item);
  if (!groupByScanDate) return base;
  const date = String(item.scanDate ?? item.crossDate ?? "").trim();
  return date ? `${base}@${date}` : base;
}

function pickDisplayName(row: {
  goldenCross?: StockVaultItem;
  maAlign?: StockVaultItem;
  ma120Near?: StockVaultItem;
  lowSlopeFlip?: StockVaultItem;
  bottomCandle?: StockVaultItem;
  bookAccum?: StockVaultItem;
  favorite?: StockVaultItem;
}) {
  return (
    row.goldenCross?.name ??
    row.maAlign?.name ??
    row.ma120Near?.name ??
    row.lowSlopeFlip?.name ??
    row.bottomCandle?.name ??
    row.bookAccum?.name ??
    row.favorite?.name ??
    row.goldenCross?.symbol ??
    row.maAlign?.symbol ??
    row.ma120Near?.symbol ??
    row.lowSlopeFlip?.symbol ??
    row.bottomCandle?.symbol ??
    row.bookAccum?.symbol ??
    row.favorite?.symbol ??
    ""
  );
}

function buildScanRow(
  key: string,
  parts: Partial<Record<StockVaultScanSource, StockVaultItem>> & {
    favorite?: StockVaultItem;
  },
  scanSources: StockVaultScanSource[],
  timeframe: StockVaultTimeframe,
): VaultDisplayRow {
  const goldenCross = parts.golden_cross;
  const maAlign = parts.ma_align;
  const ma120Near = parts.ma120_near;
  const lowSlopeFlip = parts.low_slope_flip;
  const bottomCandle = parts.bottom_candle;
  const bookAccum = parts.book_accum;
  const favorite = parts.favorite;
  const symbol =
    goldenCross?.symbol ??
    maAlign?.symbol ??
    ma120Near?.symbol ??
    lowSlopeFlip?.symbol ??
    bottomCandle?.symbol ??
    bookAccum?.symbol ??
    favorite?.symbol ??
    "";
  const market =
    goldenCross?.market ??
    maAlign?.market ??
    ma120Near?.market ??
    lowSlopeFlip?.market ??
    bottomCandle?.market ??
    bookAccum?.market ??
    favorite?.market ??
    "kr";
  const favorited = Boolean(
    goldenCross?.favorited ||
      maAlign?.favorited ||
      ma120Near?.favorited ||
      lowSlopeFlip?.favorited ||
      bottomCandle?.favorited ||
      bookAccum?.favorited ||
      favorite?.favorited,
  );
  const updatedAtMs = Math.max(
    goldenCross?.updatedAtMs ?? 0,
    maAlign?.updatedAtMs ?? 0,
    ma120Near?.updatedAtMs ?? 0,
    lowSlopeFlip?.updatedAtMs ?? 0,
    bottomCandle?.updatedAtMs ?? 0,
    bookAccum?.updatedAtMs ?? 0,
    favorite?.updatedAtMs ?? 0,
  );
  return {
    key,
    symbol,
    name: pickDisplayName({ goldenCross, maAlign, ma120Near, bottomCandle, bookAccum, favorite }),
    market,
    timeframe,
    favorited,
    updatedAtMs,
    scanSources,
    goldenCross,
    maAlign,
    ma120Near,
    lowSlopeFlip,
    bottomCandle,
    bookAccum,
    favorite,
  };
}

function isFavoriteItem(item: StockVaultItem) {
  return Boolean(item.favorited) || item.source === "favorite";
}

function matchesTimeframe(
  item: StockVaultItem,
  timeframe: StockVaultTimeframe,
) {
  if (item.source === "favorite") return true;
  return normalizeStockVaultTimeframe(item.timeframe) === timeframe;
}

function buildFavoriteRows(
  items: StockVaultItem[],
  timeframe: StockVaultTimeframe,
): VaultDisplayRow[] {
  /** @type {Map<string, Partial<Record<StockVaultScanSource, StockVaultItem>> & { favorite?: StockVaultItem }>} */
  const grouped = new Map();
  for (const it of items) {
    if (!isFavoriteItem(it)) continue;
    const key = symbolMarketTimeframeKey({
      ...it,
      timeframe: it.source === "favorite" ? timeframe : it.timeframe,
    });
    const row = grouped.get(key) ?? {};
    if (it.source === "golden_cross" && matchesTimeframe(it, timeframe)) {
      row.golden_cross = it;
    } else if (it.source === "ma_align" && matchesTimeframe(it, timeframe)) {
      row.ma_align = it;
    } else if (it.source === "ma120_near" && matchesTimeframe(it, timeframe)) {
      row.ma120_near = it;
    } else if (it.source === "low_slope_flip" && matchesTimeframe(it, timeframe)) {
      row.low_slope_flip = it;
    } else if (it.source === "bottom_candle" && matchesTimeframe(it, timeframe)) {
      row.bottom_candle = it;
    } else if (it.source === "book_accum" && matchesTimeframe(it, timeframe)) {
      row.book_accum = it;
    } else if (it.source === "favorite") {
      row.favorite = it;
    }
    grouped.set(key, row);
  }

  const rows: VaultDisplayRow[] = [];
  for (const [key, parts] of grouped) {
    const scanSources = STOCK_VAULT_SCAN_SOURCES.filter(
      (src) => parts[src],
    ) as StockVaultScanSource[];
    rows.push(buildScanRow(key, parts, scanSources, timeframe));
  }
  return rows;
}

export function countItemsByScanSource(
  items: StockVaultItem[],
  source: StockVaultScanSource,
  timeframe: StockVaultTimeframe = "1d",
) {
  return items.filter(
    (it) =>
      it.source === source &&
      normalizeStockVaultTimeframe(it.timeframe) === timeframe,
  ).length;
}

/** displayItems 1회 순회로 탐색 조건별 개수 */
export function countScanSourceTotals(
  items: StockVaultItem[],
  timeframe: StockVaultTimeframe = "1d",
): Record<StockVaultScanSource, number> {
  const tf = normalizeStockVaultTimeframe(timeframe);
  const counts: Record<StockVaultScanSource, number> = {
    golden_cross: 0,
    ma_align: 0,
    ma120_near: 0,
    low_slope_flip: 0,
    bottom_candle: 0,
    book_accum: 0,
  };
  for (const it of items) {
    const src = it.source as StockVaultScanSource;
    if (!STOCK_VAULT_SCAN_SOURCES.includes(src)) continue;
    if (normalizeStockVaultTimeframe(it.timeframe) !== tf) continue;
    counts[src] += 1;
  }
  return counts;
}

export function countFavoriteVaultItems(
  items: StockVaultItem[],
  timeframe: StockVaultTimeframe = "1d",
) {
  return buildFavoriteRows(items, timeframe).length;
}

/**
 * @param selectedScanSources — 1개면 해당 소스만, 2개 이상이면 교집합
 */
export function buildVaultDisplayRows(
  items: StockVaultItem[],
  opts: {
    selectedScanSources: StockVaultScanSource[];
    marketFilter: "all" | "kr" | "us";
    favoriteOnly: boolean;
    timeframeFilter?: StockVaultTimeframe;
    /** 동일 종목이 여러 탐색 일자에 있을 때 행을 분리 */
    groupByScanDate?: boolean;
  },
): VaultDisplayRow[] {
  const timeframe = normalizeStockVaultTimeframe(opts.timeframeFilter);
  const groupByScanDate = Boolean(opts.groupByScanDate);
  const selected = opts.selectedScanSources.filter((s) =>
    STOCK_VAULT_SCAN_SOURCES.includes(s),
  );

  if (opts.favoriteOnly) {
    let rows = buildFavoriteRows(items, timeframe);
    if (selected.length) {
      rows = rows.filter(
        (row) =>
          Boolean(row.favorite) ||
          selected.every((src) => row.scanSources.includes(src)),
      );
    }
    if (opts.marketFilter !== "all") {
      rows = rows.filter((r) => r.market === opts.marketFilter);
    }
    return sortVaultDisplayRows(rows);
  }

  if (!selected.length) return [];

  if (selected.length === 1 && !opts.favoriteOnly) {
    const src = selected[0]!;
    const rows: VaultDisplayRow[] = [];
    for (const it of items) {
      if (it.source !== src) continue;
      if (!matchesTimeframe(it, timeframe)) continue;
      rows.push(
        buildScanRow(
          vaultDisplayRowKey(it, groupByScanDate),
          { [src]: it },
          [src],
          timeframe,
        ),
      );
    }
    let filtered = rows;
    if (opts.marketFilter !== "all") {
      filtered = filtered.filter((r) => r.market === opts.marketFilter);
    }
    return sortVaultDisplayRows(filtered);
  }

  const selectedSet = new Set(selected);
  /** @type {Map<string, Partial<Record<StockVaultScanSource, StockVaultItem>>>} */
  const grouped = new Map();
  for (const it of items) {
    const src = it.source as StockVaultScanSource;
    if (!selectedSet.has(src)) continue;
    if (!matchesTimeframe(it, timeframe)) continue;
    const key = vaultDisplayRowKey(it, groupByScanDate);
    const row = grouped.get(key) ?? {};
    row[src] = it;
    grouped.set(key, row);
  }

  const rows: VaultDisplayRow[] = [];
  for (const [key, parts] of grouped) {
    if (!selected.every((src) => parts[src])) continue;
    rows.push(buildScanRow(key, parts, selected, timeframe));
  }

  let filtered = rows;
  if (opts.marketFilter !== "all") {
    filtered = filtered.filter((r) => r.market === opts.marketFilter);
  }
  return sortVaultDisplayRows(filtered);
}

export function sortVaultDisplayRows(rows: VaultDisplayRow[]): VaultDisplayRow[] {
  if (!rows.length) return rows;
  const withGc = rows.filter((r) => r.goldenCross);
  const withoutGc = rows.filter((r) => !r.goldenCross);
  if (!withGc.length) {
    return [...rows].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }
  const sortedGc = sortGoldenCrossItems(withGc.map((r) => r.goldenCross!));
  const gcRows = sortedGc.map(
    (gc) => withGc.find((r) => r.goldenCross === gc)!,
  );
  const rest = [...withoutGc].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return [...gcRows, ...rest];
}

export function countVaultIntersection(
  items: StockVaultItem[],
  selectedScanSources: StockVaultScanSource[],
  marketFilter: "all" | "kr" | "us" = "all",
  timeframeFilter: StockVaultTimeframe = "1d",
) {
  return buildVaultDisplayRows(items, {
    selectedScanSources,
    marketFilter,
    favoriteOnly: false,
    timeframeFilter,
  }).length;
}

/** 일봉 전용 탐색 조건 — 주봉 탭에서는 120선 근처만 숨김 */
const DAILY_ONLY_SCAN_SOURCES = new Set<StockVaultScanSource>([
  "ma120_near",
  "low_slope_flip",
]);

export function visibleStockVaultScanSources(
  timeframe: StockVaultTimeframe,
): StockVaultScanSource[] {
  if (timeframe === "1wk") {
    return STOCK_VAULT_SCAN_SOURCES.filter((s) => !DAILY_ONLY_SCAN_SOURCES.has(s));
  }
  return [...STOCK_VAULT_SCAN_SOURCES];
}
