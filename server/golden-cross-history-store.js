import { randomUUID } from "node:crypto";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const HISTORY_FILE = () =>
  process.env.GOLDEN_CROSS_HISTORY_TEST_FILE?.trim() ||
  "golden-cross-scan-history.json";
const MAX_ENTRIES = 180;

/**
 * @typedef {{
 *   id: string;
 *   runId: string;
 *   atMs: number;
 *   trigger: "manual" | "scheduled";
 *   market: "kr" | "us";
 *   scanDate: string;
 *   scanned: number;
 *   hitCount: number;
 *   hits: Array<{ symbol: string; name: string; market: "kr"|"us"; crosses: string[]; scanDate: string }>;
 * }} GoldenCrossHistoryEntry
 */

/** @param {unknown} raw */
function normalizeEntry(raw) {
  const market = raw?.market === "us" ? "us" : "kr";
  const hits = Array.isArray(raw?.hits)
    ? raw.hits
        .map((h) => ({
          symbol: String(h?.symbol ?? "")
            .trim()
            .toUpperCase(),
          name: String(h?.name ?? "").trim(),
          market: h?.market === "us" ? "us" : "kr",
          crosses: Array.isArray(h?.crosses)
            ? h.crosses.filter((c) => c === "5>20" || c === "5>60" || c === "5>120")
            : [],
          scanDate:
            typeof h?.scanDate === "string" && h.scanDate.trim()
              ? h.scanDate.trim()
              : String(raw?.scanDate ?? "").trim(),
        }))
        .filter((h) => h.symbol)
    : [];
  return {
    id: String(raw?.id ?? randomUUID()),
    runId: String(raw?.runId ?? randomUUID()),
    atMs:
      typeof raw?.atMs === "number" && Number.isFinite(raw.atMs)
        ? raw.atMs
        : Date.now(),
    trigger: raw?.trigger === "scheduled" ? "scheduled" : "manual",
    market,
    scanDate:
      typeof raw?.scanDate === "string" && raw.scanDate.trim()
        ? raw.scanDate.trim()
        : "",
    scanned:
      typeof raw?.scanned === "number" && Number.isFinite(raw.scanned)
        ? raw.scanned
        : 0,
    hitCount:
      typeof raw?.hitCount === "number" && Number.isFinite(raw.hitCount)
        ? raw.hitCount
        : hits.length,
    hits,
  };
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const entries = Array.isArray(raw?.entries)
    ? raw.entries.map(normalizeEntry).filter((e) => e.scanDate)
    : [];
  entries.sort((a, b) => b.atMs - a.atMs);
  return { version: 1, entries: entries.slice(0, MAX_ENTRIES) };
}

function readStore() {
  return readJsonStoreSync(
    HISTORY_FILE(),
    normalizeStore,
    () => ({ version: 1, entries: [] }),
  );
}

/** @param {ReturnType<typeof normalizeStore>} data */
function writeStore(data) {
  writeJsonStoreSync(HISTORY_FILE(), normalizeStore(data));
}

/**
 * @param {{
 *   runId?: string;
 *   trigger?: "manual" | "scheduled";
 *   market: "kr"|"us";
 *   scanDate: string;
 *   scanned: number;
 *   hits: GoldenCrossHistoryEntry["hits"];
 * }} input
 */
export function appendGoldenCrossHistoryEntrySync(input) {
  const store = readStore();
  const entry = normalizeEntry({
    id: randomUUID(),
    runId: input.runId ?? randomUUID(),
    atMs: Date.now(),
    trigger: input.trigger ?? "scheduled",
    market: input.market,
    scanDate: input.scanDate,
    scanned: input.scanned,
    hitCount: input.hits.length,
    hits: input.hits,
  });
  store.entries.unshift(entry);
  store.entries = store.entries.slice(0, MAX_ENTRIES);
  writeStore(store);
  return entry;
}

/** @param {{ scanDate?: string; limit?: number }} [opts] */
export function listGoldenCrossHistorySync(opts = {}) {
  const scanDate = String(opts.scanDate ?? "").trim();
  const limit =
    typeof opts.limit === "number" && Number.isFinite(opts.limit)
      ? Math.min(Math.max(1, opts.limit), MAX_ENTRIES)
      : 30;
  let entries = readStore().entries;
  if (scanDate) {
    entries = entries.filter((e) => e.scanDate === scanDate);
  }
  return entries.slice(0, limit);
}

/** @param {{ scanDate?: string; limit?: number }} [opts] */
export function listGoldenCrossHistoryRunsSync(opts = {}) {
  const entries = listGoldenCrossHistorySync(opts);
  /** @type {Map<string, { runId: string; atMs: number; trigger: "manual"|"scheduled"; markets: GoldenCrossHistoryEntry[] }>} */
  const byRun = new Map();
  for (const entry of entries) {
    const prev = byRun.get(entry.runId);
    if (!prev) {
      byRun.set(entry.runId, {
        runId: entry.runId,
        atMs: entry.atMs,
        trigger: entry.trigger,
        markets: [entry],
      });
    } else {
      prev.markets.push(entry);
      if (entry.atMs > prev.atMs) prev.atMs = entry.atMs;
    }
  }
  return [...byRun.values()]
    .sort((a, b) => b.atMs - a.atMs)
    .map((run) => ({
      ...run,
      markets: run.markets.sort((a, b) =>
        a.market === b.market ? 0 : a.market === "kr" ? -1 : 1,
      ),
      totalHits: run.markets.reduce((s, m) => s + m.hitCount, 0),
    }));
}

export function listGoldenCrossHistoryDatesSync() {
  const dates = new Set(
    readStore()
      .entries.map((e) => e.scanDate)
      .filter(Boolean),
  );
  return [...dates].sort((a, b) => b.localeCompare(a));
}
