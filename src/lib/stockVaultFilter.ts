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
  "bottom_candle",
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
  bottomCandle?: StockVaultItem;
  favorite?: StockVaultItem;
};

function symbolMarketTimeframeKey(
  item: Pick<StockVaultItem, "symbol" | "market" | "timeframe">,
) {
  return `${item.market}:${item.symbol.trim().toUpperCase()}:${normalizeStockVaultTimeframe(item.timeframe)}`;
}

function pickDisplayName(row: {
  goldenCross?: StockVaultItem;
  maAlign?: StockVaultItem;
  ma120Near?: StockVaultItem;
  bottomCandle?: StockVaultItem;
  favorite?: StockVaultItem;
}) {
  return (
    row.goldenCross?.name ??
    row.maAlign?.name ??
    row.ma120Near?.name ??
    row.bottomCandle?.name ??
    row.favorite?.name ??
    row.goldenCross?.symbol ??
    row.maAlign?.symbol ??
    row.ma120Near?.symbol ??
    row.bottomCandle?.symbol ??
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
  const bottomCandle = parts.bottom_candle;
  const favorite = parts.favorite;
  const symbol =
    goldenCross?.symbol ??
    maAlign?.symbol ??
    ma120Near?.symbol ??
    bottomCandle?.symbol ??
    favorite?.symbol ??
    "";
  const market =
    goldenCross?.market ??
    maAlign?.market ??
    ma120Near?.market ??
    bottomCandle?.market ??
    favorite?.market ??
    "kr";
  const favorited = Boolean(
    goldenCross?.favorited ||
      maAlign?.favorited ||
      ma120Near?.favorited ||
      bottomCandle?.favorited ||
      favorite?.favorited,
  );
  const updatedAtMs = Math.max(
    goldenCross?.updatedAtMs ?? 0,
    maAlign?.updatedAtMs ?? 0,
    ma120Near?.updatedAtMs ?? 0,
    bottomCandle?.updatedAtMs ?? 0,
    favorite?.updatedAtMs ?? 0,
  );
  return {
    key,
    symbol,
    name: pickDisplayName({ goldenCross, maAlign, ma120Near, bottomCandle, favorite }),
    market,
    timeframe,
    favorited,
    updatedAtMs,
    scanSources,
    goldenCross,
    maAlign,
    ma120Near,
    bottomCandle,
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
    } else if (it.source === "bottom_candle" && matchesTimeframe(it, timeframe)) {
      row.bottom_candle = it;
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
  },
): VaultDisplayRow[] {
  const timeframe = normalizeStockVaultTimeframe(opts.timeframeFilter);
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

  /** @type {Map<string, Partial<Record<StockVaultScanSource, StockVaultItem>>>} */
  const grouped = new Map();
  for (const it of items) {
    if (!STOCK_VAULT_SCAN_SOURCES.includes(it.source as StockVaultScanSource)) {
      continue;
    }
    if (!matchesTimeframe(it, timeframe)) continue;
    const src = it.source as StockVaultScanSource;
    const key = symbolMarketTimeframeKey(it);
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
    (gc) => withGc.find((r) => r.goldenCross!.id === gc.id)!,
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

/** 일봉 전용 탐색 조건 — 주봉 탭에서는 숨김 */
export function visibleStockVaultScanSources(
  timeframe: StockVaultTimeframe,
): StockVaultScanSource[] {
  if (timeframe === "1wk") {
    return STOCK_VAULT_SCAN_SOURCES.filter((s) => s !== "ma120_near");
  }
  return [...STOCK_VAULT_SCAN_SOURCES];
}
