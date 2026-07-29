/**
 * 종목별 재무제표 디스크 아카이브 — server/.data/financials-archive/{symbol}.json
 */
import fs from "node:fs";
import path from "node:path";
import { isDartEnabled } from "./dart.js";
import { resolveServerDataDir } from "./data-path.js";
import { ensureDataDirSync, readJsonStoreSync, writeJsonStoreSync, parseJsonText } from "./store-json.js";

const ARCHIVE_DIR = path.join(resolveServerDataDir(), "financials-archive");
const META_FILE = "financials-archive-meta.json";

/** DART 연동 이후 KR 아카이브 스키마 — 미만이면 디스크 캐시 무시 */
export const FINANCIALS_ARCHIVE_SCHEMA_VERSION = 2;

/** @type {number} */
let liveFetchDepth = 0;

export async function withLiveFinancialsFetch(fn) {
  liveFetchDepth += 1;
  try {
    return await fn();
  } finally {
    liveFetchDepth -= 1;
  }
}

export function isLiveFinancialsFetchForced() {
  return liveFetchDepth > 0;
}

/** @param {string} symbol */
function safeArchiveFileName(symbol) {
  return `${String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-^]/g, "_")}.json`;
}

/** @param {string} symbol */
export function symbolArchivePath(symbol) {
  return path.join(ARCHIVE_DIR, safeArchiveFileName(symbol));
}

function ensureArchiveDir() {
  ensureDataDirSync();
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

/**
 * @param {string} symbol
 * @returns {import("./stock-financials-archive.js").SymbolFinancialArchive | null}
 */
export function readSymbolFinancialArchive(symbol) {
  const file = symbolArchivePath(symbol);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = parseJsonText(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return /** @type {import("./stock-financials-archive.js").SymbolFinancialArchive} */ (raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} symbol
 * @param {import("./stock-financials-archive.js").SymbolFinancialArchive} payload
 */
export function writeSymbolFinancialArchive(symbol, payload) {
  ensureArchiveDir();
  const file = symbolArchivePath(symbol);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, file);
}

/** @returns {import("./stock-financials-archive.js").FinancialsArchiveMeta} */
export function readFinancialsArchiveMeta() {
  return readJsonStoreSync(
    META_FILE,
    (raw) => {
      const o = raw && typeof raw === "object" ? raw : {};
      return {
        kr: normalizeMarketMeta(o.kr),
        us: normalizeMarketMeta(o.us),
      };
    },
    () => ({ kr: null, us: null }),
  );
}

/** @param {import("./stock-financials-archive.js").FinancialsArchiveMeta} meta */
export function writeFinancialsArchiveMeta(meta) {
  writeJsonStoreSync(META_FILE, meta);
}

/** @param {unknown} v */
function normalizeMarketMeta(v) {
  if (!v || typeof v !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (v);
  const lastSessionKey =
    typeof o.lastSessionKey === "string" ? o.lastSessionKey : null;
  const lastRunAtMs =
    typeof o.lastRunAtMs === "number" && Number.isFinite(o.lastRunAtMs)
      ? o.lastRunAtMs
      : null;
  const symbolCount =
    typeof o.symbolCount === "number" && Number.isFinite(o.symbolCount)
      ? o.symbolCount
      : 0;
  const okCount =
    typeof o.okCount === "number" && Number.isFinite(o.okCount) ? o.okCount : 0;
  const failCount =
    typeof o.failCount === "number" && Number.isFinite(o.failCount)
      ? o.failCount
      : 0;
  if (!lastSessionKey && !lastRunAtMs) return null;
  return { lastSessionKey, lastRunAtMs, symbolCount, okCount, failCount };
}

/** @param {string} symbol */
function isKrArchiveSymbol(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  return sym.endsWith(".KS") || sym.endsWith(".KQ");
}

/** @param {import("./stock-financials-archive.js").SymbolFinancialArchive | null} hit */
function isKrDartArchiveStale(hit) {
  if (!hit?.periods?.periods?.length) return true;
  if ((hit.schemaVersion ?? 0) < FINANCIALS_ARCHIVE_SCHEMA_VERSION) return true;
  if (!isDartEnabled()) return false;
  if (hit.dartLinked === false) return false;
  return !hit.periods.periods.some((p) => String(p.id).startsWith("d:"));
}

/** @param {string} symbol */
export function readArchivedFinancialPeriods(symbol) {
  const hit = readSymbolFinancialArchive(symbol);
  if (!hit?.periods?.periods?.length) return null;
  if (isKrArchiveSymbol(symbol) && isKrDartArchiveStale(hit)) return null;
  return {
    ...hit.periods,
    updatedAt: hit.archivedAtMs ?? hit.periods.updatedAt ?? Date.now(),
    archiveSource: "disk",
  };
}

/**
 * @param {string} symbol
 * @param {string} periodId
 */
export function readArchivedStatementDetail(symbol, periodId) {
  const hit = readSymbolFinancialArchive(symbol);
  if (isKrArchiveSymbol(symbol) && isKrDartArchiveStale(hit)) return null;
  const detail = hit?.statements?.[periodId];
  if (!detail) return null;
  return {
    ...detail,
    updatedAt: hit.archivedAtMs ?? detail.updatedAt ?? Date.now(),
    archiveSource: "disk",
  };
}

/** @param {string} symbol */
export function readArchivedFundamentals(symbol) {
  const hit = readSymbolFinancialArchive(symbol);
  return hit?.fundamentals ?? null;
}
