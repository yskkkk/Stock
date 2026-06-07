import { randomUUID } from "node:crypto";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STORE_FILE = "stock-vault.json";

/** @typedef {"manual"|"golden_cross"} StockVaultSource */

/**
 * @typedef {{
 *   id: string;
 *   symbol: string;
 *   name: string;
 *   market: "kr"|"us";
 *   source: StockVaultSource;
 *   crosses?: ("5>20"|"5>60"|"5>120")[];
 *   scanDate?: string | null;
 *   addedAtMs: number;
 *   updatedAtMs: number;
 * }} StockVaultItem
 */

/** @typedef {{ version: 1; items: StockVaultItem[] }} StockVaultStore */

/** @param {unknown} raw */
function normalizeStore(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  /** @type {StockVaultItem[]} */
  const out = [];
  const seen = new Set();
  for (const row of items) {
    const symbol = String(row?.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    const market = row?.market === "us" ? "us" : "kr";
    const source = row?.source === "golden_cross" ? "golden_cross" : "manual";
    const crosses = Array.isArray(row?.crosses)
      ? row.crosses.filter((c) => c === "5>20" || c === "5>60" || c === "5>120")
      : [];
    out.push({
      id: String(row?.id ?? randomUUID()),
      symbol,
      name: String(row?.name ?? symbol).trim() || symbol,
      market,
      source,
      crosses: source === "golden_cross" ? crosses : undefined,
      scanDate:
        typeof row?.scanDate === "string" && row.scanDate.trim()
          ? row.scanDate.trim()
          : null,
      addedAtMs:
        typeof row?.addedAtMs === "number" && Number.isFinite(row.addedAtMs)
          ? row.addedAtMs
          : Date.now(),
      updatedAtMs:
        typeof row?.updatedAtMs === "number" && Number.isFinite(row.updatedAtMs)
          ? row.updatedAtMs
          : Date.now(),
    });
    seen.add(symbol);
  }
  out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return { version: 1, items: out };
}

function emptyStore() {
  return /** @type {StockVaultStore} */ ({ version: 1, items: [] });
}

function readStore() {
  return readJsonStoreSync(STORE_FILE, normalizeStore, emptyStore);
}

/** @param {StockVaultStore} data */
function writeStore(data) {
  writeJsonStoreSync(STORE_FILE, normalizeStore(data));
}

export function listStockVaultItemsSync() {
  return readStore().items;
}

/**
 * @param {{ symbol: string; name?: string; market: "kr"|"us"; source?: StockVaultSource; crosses?: string[]; scanDate?: string | null }} input
 */
export function upsertStockVaultItemSync(input) {
  const symbol = String(input.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) {
    const err = new Error("symbol required");
    err.code = "INVALID_SYMBOL";
    throw err;
  }
  const market = input.market === "us" ? "us" : "kr";
  const now = Date.now();
  const store = readStore();
  const idx = store.items.findIndex((it) => it.symbol === symbol);
  const source = input.source === "golden_cross" ? "golden_cross" : "manual";
  const crosses = Array.isArray(input.crosses)
    ? input.crosses.filter((c) => c === "5>20" || c === "5>60" || c === "5>120")
    : [];

  if (idx >= 0) {
    const prev = store.items[idx];
    const mergedCrosses =
      source === "golden_cross"
        ? [...new Set([...(prev.crosses ?? []), ...crosses])]
        : prev.crosses;
    store.items[idx] = {
      ...prev,
      name: String(input.name ?? prev.name).trim() || prev.name,
      market,
      source: prev.source === "manual" && source === "golden_cross" ? "golden_cross" : prev.source === "golden_cross" ? "golden_cross" : source,
      crosses: mergedCrosses?.length ? mergedCrosses : undefined,
      scanDate:
        input.scanDate != null
          ? input.scanDate
          : prev.scanDate ?? null,
      updatedAtMs: now,
    };
  } else {
    store.items.unshift({
      id: randomUUID(),
      symbol,
      name: String(input.name ?? symbol).trim() || symbol,
      market,
      source,
      crosses: crosses.length ? crosses : undefined,
      scanDate: input.scanDate ?? null,
      addedAtMs: now,
      updatedAtMs: now,
    });
  }
  writeStore(store);
  return store.items.find((it) => it.symbol === symbol) ?? null;
}

/** @param {string} symbol */
export function removeStockVaultItemSync(symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return false;
  const store = readStore();
  const next = store.items.filter((it) => it.symbol !== sym);
  if (next.length === store.items.length) return false;
  writeStore({ version: 1, items: next });
  return true;
}

/**
 * @param {Array<{ symbol: string; name: string; market: "kr"|"us"; crosses: string[]; scanDate: string }>} hits
 */
export function mergeGoldenCrossHitsIntoVaultSync(hits) {
  for (const hit of hits) {
    upsertStockVaultItemSync({
      symbol: hit.symbol,
      name: hit.name,
      market: hit.market,
      source: "golden_cross",
      crosses: hit.crosses,
      scanDate: hit.scanDate,
    });
  }
}
