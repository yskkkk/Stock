import type { StockVaultItem, StockVaultScanSource } from "../types";

const STORAGE_KEY = "stock-vault-local-scan-snapshots-v1";
const SCAN_SOURCES = new Set<StockVaultScanSource>([
  "golden_cross",
  "ma_align",
  "ma120_near",
]);

type SnapshotStore = {
  version: 1;
  byDate: Record<string, { items: StockVaultItem[]; updatedAtMs: number }>;
};

function scanItemKey(item: Pick<StockVaultItem, "source" | "market" | "symbol">) {
  return `${item.source}:${item.market}:${item.symbol.trim().toUpperCase()}`;
}

function isScanItem(item: StockVaultItem): boolean {
  return SCAN_SOURCES.has(item.source);
}

function readStore(): SnapshotStore {
  if (typeof localStorage === "undefined") {
    return { version: 1, byDate: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, byDate: {} };
    const parsed = JSON.parse(raw) as Partial<SnapshotStore>;
    if (parsed.version !== 1 || !parsed.byDate || typeof parsed.byDate !== "object") {
      return { version: 1, byDate: {} };
    }
    const byDate: SnapshotStore["byDate"] = {};
    for (const [date, row] of Object.entries(parsed.byDate)) {
      if (!date.trim() || !Array.isArray(row?.items)) continue;
      byDate[date.trim()] = {
        items: row.items.filter(
          (it): it is StockVaultItem =>
            Boolean(it?.symbol && it?.market && isScanItem(it as StockVaultItem)),
        ),
        updatedAtMs:
          typeof row.updatedAtMs === "number" && Number.isFinite(row.updatedAtMs)
            ? row.updatedAtMs
            : Date.now(),
      };
    }
    return { version: 1, byDate };
  } catch {
    return { version: 1, byDate: {} };
  }
}

function writeStore(store: SnapshotStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

export function peekLocalScanSnapshot(scanDate: string): StockVaultItem[] | null {
  const date = scanDate.trim();
  if (!date) return null;
  const row = readStore().byDate[date];
  return row?.items?.length ? row.items.map((it) => ({ ...it })) : null;
}

export function saveLocalScanSnapshot(
  scanDate: string,
  items: StockVaultItem[],
): StockVaultItem[] {
  const date = scanDate.trim();
  if (!date) return [];
  const scanItems = items.filter(isScanItem).map((it) => ({ ...it }));
  const store = readStore();
  store.byDate[date] = { items: scanItems, updatedAtMs: Date.now() };
  writeStore(store);
  return scanItems;
}

/** 탐색마다 신규·갱신만 반영하고, 이전에 잡힌 종목은 유지 */
export function mergeScanItemsIntoSnapshot(
  existing: StockVaultItem[],
  incoming: StockVaultItem[],
): StockVaultItem[] {
  const map = new Map<string, StockVaultItem>();
  for (const it of existing.filter(isScanItem)) {
    map.set(scanItemKey(it), { ...it });
  }
  for (const it of incoming.filter(isScanItem)) {
    const key = scanItemKey(it);
    const prev = map.get(key);
    if (!prev || (it.addedAtMs ?? 0) >= (prev.addedAtMs ?? 0)) {
      map.set(key, { ...it });
    }
  }
  return [...map.values()];
}

export function mergeLocalScanSnapshot(
  scanDate: string,
  incoming: StockVaultItem[],
): StockVaultItem[] {
  const date = scanDate.trim();
  if (!date) return [];
  const merged = mergeScanItemsIntoSnapshot(
    peekLocalScanSnapshot(date) ?? [],
    incoming,
  );
  saveLocalScanSnapshot(date, merged);
  return merged;
}

export function listLocalScanSnapshotDates(): string[] {
  const byDate = readStore().byDate;
  return Object.keys(byDate)
    .filter((d) => (byDate[d]?.items?.length ?? 0) > 0)
    .sort((a, b) => b.localeCompare(a));
}

export function extractScanItemsFromVault(
  items: StockVaultItem[] | undefined,
): StockVaultItem[] {
  return (items ?? []).filter(isScanItem).map((it) => ({ ...it }));
}
