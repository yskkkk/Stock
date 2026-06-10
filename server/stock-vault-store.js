import { randomUUID } from "node:crypto";
import { resolveDisplayName } from "./names-ko.js";
import { listAllFavoritedSymbolsSync } from "./user-stock-vault-store.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import { normalizeMaCrossKinds } from "./golden-cross-detect.js";
import {
  normalizeVaultScanTimeframe,
  VAULT_SCAN_TIMEFRAME_DEFAULT,
} from "./vault-scan-timeframe.js";

function vaultStoreFile() {
  return process.env.STOCK_VAULT_STORE_TEST_FILE?.trim() || "stock-vault.json";
}

/** @typedef {"golden_cross"|"ma_align"} StockVaultSource */

/**
 * @typedef {{
 *   id: string;
 *   symbol: string;
 *   name: string;
 *   market: "kr"|"us";
 *   source: StockVaultSource;
 *   timeframe?: "1d"|"1wk";
 *   crosses?: import("./golden-cross-detect.js").MaCrossKind[];
 *   crossDate?: string | null;
 *   scanDate?: string | null;
 *   addedAtMs: number;
 *   updatedAtMs: number;
 * }} StockVaultItem
 */

/** @typedef {{ version: 1; items: StockVaultItem[]; dismissed?: string[] }} StockVaultStore */

const TEST_JUNK_NAMES = new Set(["골든", "즐겨", "수동", "테스트"]);

/** @param {unknown} source */
function normalizeSource(source) {
  if (source === "golden_cross") return "golden_cross";
  if (source === "ma_align") return "ma_align";
  return null;
}

/** @param {StockVaultItem} item */
function itemKey(item) {
  const tf = normalizeVaultScanTimeframe(item.timeframe);
  return `${item.symbol}:${item.source}:${tf}`;
}

/** @param {unknown} row */
function isTestGarbageItem(row) {
  const sym = String(row?.symbol ?? "")
    .trim()
    .toUpperCase();
  const name = String(row?.name ?? "").trim();
  if (!TEST_JUNK_NAMES.has(name)) return false;
  return /^(TEST|GC|GCV|MAN|FAV)\d/i.test(sym);
}

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
    if (!symbol || seen.has(`${symbol}:${normalizeSource(row?.source)}:${normalizeVaultScanTimeframe(row?.timeframe)}`)) continue;
    if (isTestGarbageItem(row)) continue;
    const source = normalizeSource(row?.source);
    if (!source) continue;
    const market = row?.market === "us" ? "us" : "kr";
    const crosses = normalizeMaCrossKinds(row?.crosses);
    const timeframe = normalizeVaultScanTimeframe(row?.timeframe);
    const item = {
      id: String(row?.id ?? randomUUID()),
      symbol,
      name: resolveDisplayName(symbol, String(row?.name ?? symbol).trim() || symbol),
      market,
      source,
      timeframe,
      crosses: source === "golden_cross" ? crosses : undefined,
      crossDate:
        source === "golden_cross" &&
        typeof row?.crossDate === "string" &&
        row.crossDate.trim()
          ? row.crossDate.trim()
          : source === "golden_cross" &&
              typeof row?.scanDate === "string" &&
              row.scanDate.trim()
            ? row.scanDate.trim()
            : null,
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
    };
    out.push(item);
    seen.add(itemKey(item));
  }
  out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  const dismissed = Array.isArray(raw?.dismissed)
    ? [
        ...new Set(
          raw.dismissed
            .map((s) => String(s ?? "").trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
    : [];
  return { version: 1, items: out, dismissed };
}

function emptyStore() {
  return /** @type {StockVaultStore} */ ({ version: 1, items: [], dismissed: [] });
}

function readStore() {
  const empty = emptyStore();
  const raw = readJsonStoreSync(vaultStoreFile(), (v) => v, () => empty);
  const normalized = normalizeStore(raw);
  const rawLen = Array.isArray(raw?.items) ? raw.items.length : 0;
  if (rawLen !== normalized.items.length) {
    writeStore(normalized);
  }
  return normalized;
}

/** @param {StockVaultStore} data */
function writeStore(data) {
  writeJsonStoreSync(vaultStoreFile(), normalizeStore(data));
}

export function listStockVaultItemsSync() {
  return readStore().items;
}

/**
 * @param {{ symbol: string; name?: string; market: "kr"|"us"; source?: StockVaultSource; timeframe?: import("./vault-scan-timeframe.js").VaultScanTimeframe; crosses?: string[]; crossDate?: string | null; scanDate?: string | null }} input
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
  const source = normalizeSource(input.source);
  if (!source) {
    const err = new Error("invalid source");
    err.code = "INVALID_SOURCE";
    throw err;
  }
  const crosses = normalizeMaCrossKinds(input.crosses);
  const timeframe = normalizeVaultScanTimeframe(input.timeframe);
  const idx = store.items.findIndex(
    (it) =>
      it.symbol === symbol &&
      it.source === source &&
      normalizeVaultScanTimeframe(it.timeframe) === timeframe,
  );

  if (idx >= 0) {
    const prev = store.items[idx];
    const mergedCrosses =
      source === "golden_cross"
        ? [...new Set([...(prev.crosses ?? []), ...crosses])]
        : prev.crosses;
    store.items[idx] = {
      ...prev,
      name: resolveDisplayName(symbol, String(input.name ?? prev.name).trim() || prev.name),
      market,
      source,
      timeframe,
      crosses: mergedCrosses?.length ? mergedCrosses : undefined,
      crossDate:
        source === "golden_cross"
          ? input.crossDate != null
            ? input.crossDate
            : input.scanDate != null
              ? input.scanDate
              : prev.crossDate ?? null
          : undefined,
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
      name: resolveDisplayName(symbol, String(input.name ?? symbol).trim() || symbol),
      market,
      source,
      timeframe,
      crosses: crosses.length ? crosses : undefined,
      crossDate:
        source === "golden_cross"
          ? (input.crossDate ?? input.scanDate ?? null)
          : undefined,
      scanDate: input.scanDate ?? null,
      addedAtMs: now,
      updatedAtMs: now,
    });
  }
  writeStore(store);
  return store.items.find(
    (it) =>
      it.symbol === symbol &&
      it.source === source &&
      normalizeVaultScanTimeframe(it.timeframe) === timeframe,
  ) ?? null;
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
  const dismissed = new Set(store.dismissed ?? []);
  dismissed.add(sym);
  writeStore({ version: 1, items: next, dismissed: [...dismissed] });
  return true;
}

/**
 * @param {string} symbol
 * @param {StockVaultSource} source
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe]
 */
export function removeStockVaultItemBySourceSync(symbol, source, timeframe) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const src = normalizeSource(source);
  if (!sym) return false;
  const tf =
    timeframe == null ? null : normalizeVaultScanTimeframe(timeframe);
  const store = readStore();
  const next = store.items.filter((it) => {
    if (it.symbol !== sym || it.source !== src) return true;
    if (tf == null) return false;
    return normalizeVaultScanTimeframe(it.timeframe) !== tf;
  });
  if (next.length === store.items.length) return false;
  writeStore({ version: 1, items: next, dismissed: store.dismissed ?? [] });
  return true;
}

/**
 * 골든크로스 자동 탐색 종목만 제거(즐겨찾기·dismissed 유지).
 * @param {{ market?: "kr"|"us"; preserveFavorites?: boolean; timeframe?: import("./vault-scan-timeframe.js").VaultScanTimeframe }} [opts]
 * @returns {number} 제거된 종목 수
 */
export function clearGoldenCrossVaultItemsSync(opts = {}) {
  const marketFilter = opts.market === "kr" || opts.market === "us" ? opts.market : null;
  const timeframeFilter =
    opts.timeframe == null ? null : normalizeVaultScanTimeframe(opts.timeframe);
  const preserveFavorites = opts.preserveFavorites !== false;
  const favorited = preserveFavorites ? listAllFavoritedSymbolsSync() : new Set();
  const store = readStore();
  const before = store.items.length;
  store.items = store.items.filter((it) => {
    if (it.source !== "golden_cross") return true;
    if (marketFilter && it.market !== marketFilter) return true;
    if (
      timeframeFilter &&
      normalizeVaultScanTimeframe(it.timeframe) !== timeframeFilter
    ) {
      return true;
    }
    if (favorited.has(it.symbol)) return true;
    return false;
  });
  if (store.items.length !== before) {
    writeStore(store);
  }
  return before - store.items.length;
}

export function clearMaAlignVaultItemsSync(opts = {}) {
  const marketFilter = opts.market === "kr" || opts.market === "us" ? opts.market : null;
  const timeframeFilter =
    opts.timeframe == null ? null : normalizeVaultScanTimeframe(opts.timeframe);
  const preserveFavorites = opts.preserveFavorites !== false;
  const favorited = preserveFavorites ? listAllFavoritedSymbolsSync() : new Set();
  const store = readStore();
  const before = store.items.length;
  store.items = store.items.filter((it) => {
    if (it.source !== "ma_align") return true;
    if (marketFilter && it.market !== marketFilter) return true;
    if (
      timeframeFilter &&
      normalizeVaultScanTimeframe(it.timeframe) !== timeframeFilter
    ) {
      return true;
    }
    if (favorited.has(it.symbol)) return true;
    return false;
  });
  if (store.items.length !== before) {
    writeStore(store);
  }
  return before - store.items.length;
}

/**
 * @param {Array<{ symbol: string; name: string; market: "kr"|"us"; scanDate: string }>} hits
 */
export function mergeMaAlignHitsIntoVaultSync(hits) {
  const dismissed = new Set(readStore().dismissed ?? []);
  for (const hit of hits) {
    const sym = String(hit.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!sym || dismissed.has(sym)) continue;
    upsertStockVaultItemSync({
      symbol: hit.symbol,
      name: hit.name,
      market: hit.market,
      source: "ma_align",
      timeframe: hit.timeframe ?? VAULT_SCAN_TIMEFRAME_DEFAULT,
      scanDate: hit.scanDate,
    });
  }
}

/**
 * @param {Array<{ symbol: string; name: string; market: "kr"|"us"; crosses: string[]; crossDate?: string | null; scanDate: string }>} hits
 */
export function mergeGoldenCrossHitsIntoVaultSync(hits) {
  const dismissed = new Set(readStore().dismissed ?? []);
  for (const hit of hits) {
    const sym = String(hit.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!sym || dismissed.has(sym)) continue;
    upsertStockVaultItemSync({
      symbol: hit.symbol,
      name: hit.name,
      market: hit.market,
      source: "golden_cross",
      timeframe: hit.timeframe ?? VAULT_SCAN_TIMEFRAME_DEFAULT,
      crosses: hit.crosses,
      crossDate: hit.crossDate ?? hit.scanDate,
      scanDate: hit.scanDate,
    });
  }
}
