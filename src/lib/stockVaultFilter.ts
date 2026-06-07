import { sortGoldenCrossItems } from "./goldenCrossRecency";
import type { StockVaultItem, StockVaultScanSource } from "../types";

/** 자동 탐색 조건 — 새 유형 추가 시 여기만 확장 */
export const STOCK_VAULT_SCAN_SOURCES: readonly StockVaultScanSource[] = [
  "golden_cross",
  "ma_align",
];

export type VaultDisplayRow = {
  key: string;
  symbol: string;
  name: string;
  market: "kr" | "us";
  favorited: boolean;
  updatedAtMs: number;
  scanSources: StockVaultScanSource[];
  goldenCross?: StockVaultItem;
  maAlign?: StockVaultItem;
  favorite?: StockVaultItem;
};

function symbolMarketKey(item: Pick<StockVaultItem, "symbol" | "market">) {
  return `${item.market}:${item.symbol.trim().toUpperCase()}`;
}

function pickDisplayName(row: {
  goldenCross?: StockVaultItem;
  maAlign?: StockVaultItem;
  favorite?: StockVaultItem;
}) {
  return (
    row.goldenCross?.name ??
    row.maAlign?.name ??
    row.favorite?.name ??
    row.goldenCross?.symbol ??
    row.maAlign?.symbol ??
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
): VaultDisplayRow {
  const goldenCross = parts.golden_cross;
  const maAlign = parts.ma_align;
  const favorite = parts.favorite;
  const symbol =
    goldenCross?.symbol ?? maAlign?.symbol ?? favorite?.symbol ?? "";
  const market =
    goldenCross?.market ?? maAlign?.market ?? favorite?.market ?? "kr";
  const favorited = Boolean(
    goldenCross?.favorited || maAlign?.favorited || favorite?.favorited,
  );
  const updatedAtMs = Math.max(
    goldenCross?.updatedAtMs ?? 0,
    maAlign?.updatedAtMs ?? 0,
    favorite?.updatedAtMs ?? 0,
  );
  return {
    key,
    symbol,
    name: pickDisplayName({ goldenCross, maAlign, favorite }),
    market,
    favorited,
    updatedAtMs,
    scanSources,
    goldenCross,
    maAlign,
    favorite,
  };
}

function isFavoriteItem(item: StockVaultItem) {
  return Boolean(item.favorited) || item.source === "favorite";
}

function buildFavoriteRows(items: StockVaultItem[]): VaultDisplayRow[] {
  /** @type {Map<string, Partial<Record<StockVaultScanSource, StockVaultItem>> & { favorite?: StockVaultItem }>} */
  const grouped = new Map();
  for (const it of items) {
    if (!isFavoriteItem(it)) continue;
    const key = symbolMarketKey(it);
    const row = grouped.get(key) ?? {};
    if (it.source === "golden_cross") row.golden_cross = it;
    else if (it.source === "ma_align") row.ma_align = it;
    else if (it.source === "favorite") row.favorite = it;
    grouped.set(key, row);
  }

  const rows: VaultDisplayRow[] = [];
  for (const [key, parts] of grouped) {
    const scanSources = STOCK_VAULT_SCAN_SOURCES.filter(
      (src) => parts[src],
    ) as StockVaultScanSource[];
    rows.push(buildScanRow(key, parts, scanSources));
  }
  return rows;
}

export function countItemsByScanSource(
  items: StockVaultItem[],
  source: StockVaultScanSource,
) {
  return items.filter((it) => it.source === source).length;
}

export function countFavoriteVaultItems(items: StockVaultItem[]) {
  return buildFavoriteRows(items).length;
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
  },
): VaultDisplayRow[] {
  const selected = opts.selectedScanSources.filter((s) =>
    STOCK_VAULT_SCAN_SOURCES.includes(s),
  );

  if (opts.favoriteOnly) {
    let rows = buildFavoriteRows(items);
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
    const src = it.source as StockVaultScanSource;
    const key = symbolMarketKey(it);
    const row = grouped.get(key) ?? {};
    row[src] = it;
    grouped.set(key, row);
  }

  const rows: VaultDisplayRow[] = [];
  for (const [key, parts] of grouped) {
    if (!selected.every((src) => parts[src])) continue;
    rows.push(buildScanRow(key, parts, selected));
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
) {
  return buildVaultDisplayRows(items, {
    selectedScanSources,
    marketFilter,
    favoriteOnly: false,
  }).length;
}
