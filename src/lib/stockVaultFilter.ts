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
  manual?: StockVaultItem;
};

function symbolMarketKey(item: Pick<StockVaultItem, "symbol" | "market">) {
  return `${item.market}:${item.symbol.trim().toUpperCase()}`;
}

function pickDisplayName(row: {
  goldenCross?: StockVaultItem;
  maAlign?: StockVaultItem;
  manual?: StockVaultItem;
}) {
  return (
    row.goldenCross?.name ??
    row.maAlign?.name ??
    row.manual?.name ??
    row.goldenCross?.symbol ??
    row.maAlign?.symbol ??
    row.manual?.symbol ??
    ""
  );
}

function buildScanRow(
  key: string,
  parts: Partial<Record<StockVaultScanSource, StockVaultItem>>,
  scanSources: StockVaultScanSource[],
): VaultDisplayRow {
  const goldenCross = parts.golden_cross;
  const maAlign = parts.ma_align;
  const symbol =
    goldenCross?.symbol ?? maAlign?.symbol ?? "";
  const market = goldenCross?.market ?? maAlign?.market ?? "kr";
  const favorited = Boolean(goldenCross?.favorited || maAlign?.favorited);
  const updatedAtMs = Math.max(
    goldenCross?.updatedAtMs ?? 0,
    maAlign?.updatedAtMs ?? 0,
  );
  return {
    key,
    symbol,
    name: pickDisplayName({ goldenCross, maAlign }),
    market,
    favorited,
    updatedAtMs,
    scanSources,
    goldenCross,
    maAlign,
  };
}

export function countItemsByScanSource(
  items: StockVaultItem[],
  source: StockVaultScanSource,
) {
  return items.filter((it) => it.source === source).length;
}

/**
 * @param selectedScanSources — 1개면 해당 소스만, 2개 이상이면 교집합
 */
export function buildVaultDisplayRows(
  items: StockVaultItem[],
  opts: {
    view: "scan" | "manual";
    selectedScanSources: StockVaultScanSource[];
    marketFilter: "all" | "kr" | "us";
    favoriteOnly: boolean;
  },
): VaultDisplayRow[] {
  const selected = opts.selectedScanSources.filter((s) =>
    STOCK_VAULT_SCAN_SOURCES.includes(s),
  );
  if (opts.view === "manual") {
    let rows = items
      .filter((it) => it.source === "manual")
      .map(
        (it): VaultDisplayRow => ({
          key: it.id,
          symbol: it.symbol,
          name: it.name,
          market: it.market,
          favorited: Boolean(it.favorited),
          updatedAtMs: it.updatedAtMs,
          scanSources: [],
          manual: it,
        }),
      );
    if (opts.marketFilter !== "all") {
      rows = rows.filter((r) => r.market === opts.marketFilter);
    }
    if (opts.favoriteOnly) {
      rows = rows.filter((r) => r.favorited);
    }
    return rows;
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

  /** @type {VaultDisplayRow[]} */
  const rows = [];
  for (const [key, parts] of grouped) {
    if (!selected.every((src) => parts[src])) continue;
    rows.push(buildScanRow(key, parts, selected));
  }

  let filtered = rows;
  if (opts.marketFilter !== "all") {
    filtered = filtered.filter((r) => r.market === opts.marketFilter);
  }
  if (opts.favoriteOnly) {
    filtered = filtered.filter((r) => r.favorited);
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
    view: "scan",
    selectedScanSources,
    marketFilter,
    favoriteOnly: false,
  }).length;
}
