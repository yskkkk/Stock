import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveServerDataDir } from "../data-path.js";
import { readBoxRangeStoreSync, writeBoxRangeStoreSync } from "./store.js";
import {
  BOX_RANGE_CATALOG_DIR_LEGACY,
  BOX_RANGE_CATALOG_DIR_PINE,
} from "./constants.js";
import { pineBoxesShouldMerge } from "./detect-pine.js";

/** @typedef {"us"|"kr"} CatalogMarket */

export const CATALOG_MARKETS = /** @type {const} */ (["us", "kr"]);

export { BOX_RANGE_CATALOG_DIR_LEGACY, BOX_RANGE_CATALOG_DIR_PINE };

/** @returns {string} server/.data 하위 카탈로그 루트 폴더명 */
export function resolveCatalogRootDir() {
  const raw = String(process.env.STOCK_BOX_RANGE_CATALOG_DIR ?? "").trim();
  return raw || BOX_RANGE_CATALOG_DIR_PINE;
}

/**
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
export function catalogDirForRoot(market = "us", catalogRoot = resolveCatalogRootDir()) {
  return path.join(
    resolveServerDataDir(),
    catalogRoot,
    resolveCatalogMarket(market),
  );
}

/**
 * @param {unknown} raw
 * @returns {CatalogMarket}
 */
export function resolveCatalogMarket(raw) {
  return String(raw ?? "").trim().toLowerCase() === "kr" ? "kr" : "us";
}

/**
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
function catalogDir(market = "us", catalogRoot = resolveCatalogRootDir()) {
  return catalogDirForRoot(market, catalogRoot);
}

/**
 * @param {string} symbol
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
function symbolFilePath(symbol, market = "us", catalogRoot = resolveCatalogRootDir()) {
  return path.join(
    catalogDir(market, catalogRoot),
    `${String(symbol).trim().toUpperCase()}.json`,
  );
}

/**
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
function indexFilePath(market = "us", catalogRoot = resolveCatalogRootDir()) {
  return path.join(catalogDir(market, catalogRoot), "_index.json");
}

/**
 * @typedef {{
 *   catalogBoxId: string;
 *   timeframe: "1h"|"4h"|"1d";
 *   top: number;
 *   bottom: number;
 *   mid: number;
 *   leftTime: number;
 *   rightTime: number;
 *   validBars: number;
 *   detectedAtMs: number;
 *   tradeEligible: boolean;
 *   consumedAtMs: number | null;
 *   consumedReason: string | null;
 * }} CatalogBox
 */

/**
 * @typedef {{
 *   symbol: string;
 *   name: string;
 *   updatedAtMs: number;
 *   scanError: string | null;
 *   boxes: CatalogBox[];
 * }} SymbolCatalogFile
 */

function barSecForTf(tf) {
  if (tf === "1h") return 3600;
  if (tf === "4h") return 4 * 3600;
  return 86400;
}

function normalizeCatalogBox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const tf = String(o.timeframe ?? "").trim();
  if (!["1h", "4h", "1d"].includes(tf)) return null;
  const top = Number(o.top);
  const bottom = Number(o.bottom);
  const mid = Number(o.mid);
  if (
    !Number.isFinite(top) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(mid) ||
    top <= bottom
  ) {
    return null;
  }
  const id = String(o.catalogBoxId ?? "").trim() || randomUUID();
  return {
    catalogBoxId: id,
    timeframe: /** @type {"1h"|"4h"|"1d"} */ (tf),
    top,
    bottom,
    mid,
    leftTime: Number(o.leftTime) || 0,
    rightTime: Number(o.rightTime) || 0,
    validBars: Number(o.validBars) || 0,
    detectedAtMs: Number(o.detectedAtMs) || Date.now(),
    tradeEligible: o.tradeEligible !== false,
    consumedAtMs:
      typeof o.consumedAtMs === "number" && o.consumedAtMs > 0
        ? o.consumedAtMs
        : null,
    consumedReason:
      typeof o.consumedReason === "string" && o.consumedReason.trim()
        ? o.consumedReason.trim()
        : null,
  };
}

/**
 * @param {string} symbol
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
export function readSymbolCatalogSync(
  symbol,
  market = "us",
  catalogRoot = resolveCatalogRootDir(),
) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  const m = resolveCatalogMarket(market);
  try {
    const file = symbolFilePath(sym, m, catalogRoot);
    if (!fs.existsSync(file)) return null;
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!o || typeof o !== "object") return null;
    const boxes = Array.isArray(o.boxes)
      ? o.boxes.map(normalizeCatalogBox).filter(Boolean)
      : [];
    return {
      symbol: sym,
      name: String(o.name ?? sym),
      updatedAtMs: Number(o.updatedAtMs) || 0,
      scanError:
        typeof o.scanError === "string" && o.scanError.trim()
          ? o.scanError.trim()
          : null,
      boxes,
    };
  } catch {
    return null;
  }
}

/**
 * @param {SymbolCatalogFile} payload
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
export function writeSymbolCatalogSync(
  payload,
  market = "us",
  catalogRoot = resolveCatalogRootDir(),
) {
  const sym = String(payload.symbol ?? "").trim().toUpperCase();
  if (!sym) return;
  const m = resolveCatalogMarket(market);
  const dir = catalogDir(m, catalogRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = symbolFilePath(sym, m, catalogRoot);
  const tmp = `${file}.tmp`;
  const body = {
    symbol: sym,
    name: String(payload.name ?? sym),
    updatedAtMs: payload.updatedAtMs || Date.now(),
    scanError: payload.scanError ?? null,
    boxes: payload.boxes,
  };
  fs.writeFileSync(tmp, JSON.stringify(body, null, 0), "utf8");
  fs.renameSync(tmp, file);
  refreshCatalogIndexSync(m, catalogRoot);
}

/**
 * @param {import("./detect-pine.js").DetectedBox} detected
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {CatalogBox | null} prevMatch
 */
function detectedToCatalogBox(detected, timeframe, prevMatch) {
  return {
    catalogBoxId: prevMatch?.catalogBoxId ?? randomUUID(),
    timeframe,
    top: detected.top,
    bottom: detected.bottom,
    mid: detected.mid,
    leftTime: detected.leftTime,
    rightTime: detected.rightTime,
    validBars: detected.validBars ?? 0,
    detectedAtMs: Date.now(),
    tradeEligible: prevMatch?.tradeEligible !== false,
    consumedAtMs: prevMatch?.consumedAtMs ?? null,
    consumedReason: prevMatch?.consumedReason ?? null,
  };
}

/**
 * Pine 전체 차트 탐지 결과로 TF별 저장 목록 교체(서버 overlap 병합 없음).
 * 이전 consumed 박스는 Pine f_shouldMerge로 매칭되면 id·소비 상태 유지.
 *
 * @param {string} symbol
 * @param {string} name
 * @param {Partial<Record<"1h"|"4h"|"1d", import("./detect-pine.js").DetectedBox[]>>} byTf
 * @param {string | null} scanError
 * @param {CatalogMarket} [market]
 */
export function upsertSymbolCatalogDetectionsSync(
  symbol,
  name,
  byTf,
  scanError = null,
  market = "us",
  catalogRoot = resolveCatalogRootDir(),
) {
  const sym = String(symbol).trim().toUpperCase();
  const m = resolveCatalogMarket(market);
  const prev = readSymbolCatalogSync(sym, m, catalogRoot);
  const prevBoxes = prev?.boxes ?? [];
  const now = Date.now();
  /** @type {CatalogBox[]} */
  const boxes = [];

  for (const tf of /** @type {const} */ (["1h", "4h", "1d"])) {
    const list = byTf[tf];
    if (!Array.isArray(list)) {
      for (const b of prevBoxes) {
        if (b.timeframe === tf) boxes.push(b);
      }
      continue;
    }
    const prevTf = prevBoxes.filter((b) => b.timeframe === tf);
    for (const d of list) {
      const det = {
        top: d.top,
        bottom: d.bottom,
        leftTime: d.leftTime,
        rightTime: d.rightTime,
      };
      let prevMatch = null;
      for (const p of prevTf) {
        if (
          pineBoxesShouldMerge(det, p, tf) ||
          pineBoxesShouldMerge(p, det, tf)
        ) {
          prevMatch = p;
          break;
        }
      }
      boxes.push(detectedToCatalogBox(d, tf, prevMatch));
    }
  }

  writeSymbolCatalogSync(
    {
      symbol: sym,
      name: name || prev?.name || sym,
      updatedAtMs: now,
      scanError,
      boxes,
    },
    m,
    catalogRoot,
  );
}

/**
 * @param {CatalogMarket} [market]
 * @param {string} [catalogRoot]
 */
export function refreshCatalogIndexSync(
  market = "us",
  catalogRoot = resolveCatalogRootDir(),
) {
  const m = resolveCatalogMarket(market);
  const dir = catalogDir(m, catalogRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "_index.json");
  /** @type {{ symbol: string; name: string; updatedAtMs: number; eligibleCount: number; boxCount: number }[]} */
  const entries = [];
  for (const f of files) {
    const sym = f.replace(/\.json$/i, "");
    const cat = readSymbolCatalogSync(sym, m, catalogRoot);
    if (!cat) continue;
    const eligible = cat.boxes.filter((b) => b.tradeEligible && !b.consumedAtMs);
    entries.push({
      symbol: cat.symbol,
      name: cat.name,
      updatedAtMs: cat.updatedAtMs,
      eligibleCount: eligible.length,
      boxCount: cat.boxes.length,
    });
  }
  entries.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const idx = {
    market: m,
    catalogRoot,
    updatedAtMs: Date.now(),
    count: entries.length,
    symbols: entries,
  };
  const file = indexFilePath(m, catalogRoot);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 0), "utf8");
  fs.renameSync(tmp, file);
  return idx;
}

/**
 * 카탈로그 루트별 박스 개수 집계(비교 리포트용)
 * @param {string} catalogRoot
 * @param {CatalogMarket} market
 */
export function summarizeCatalogRootSync(catalogRoot, market = "us") {
  const m = resolveCatalogMarket(market);
  const dir = catalogDirForRoot(m, catalogRoot);
  /** @type {Record<"1h"|"4h"|"1d", number>} */
  const byTf = { "1h": 0, "4h": 0, "1d": 0 };
  let symbols = 0;
  let withBoxes = 0;
  let total = 0;
  if (!fs.existsSync(dir)) {
    return { catalogRoot, market: m, symbols, withBoxes, total, byTf };
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "_index.json") continue;
    symbols += 1;
    const sym = f.replace(/\.json$/i, "");
    const cat = readSymbolCatalogSync(sym, m, catalogRoot);
    if (!cat?.boxes?.length) continue;
    withBoxes += 1;
    for (const b of cat.boxes) {
      if (b.timeframe in byTf) byTf[b.timeframe] += 1;
      total += 1;
    }
  }
  return { catalogRoot, market: m, symbols, withBoxes, total, byTf };
}

/**
 * @param {CatalogMarket} [market]
 */
export function readCatalogIndexSync(market = "us") {
  const m = resolveCatalogMarket(market);
  try {
    const file = indexFilePath(m);
    if (!fs.existsSync(file)) return refreshCatalogIndexSync(m);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return refreshCatalogIndexSync(m);
  }
}

/**
 * @param {string} symbol
 * @param {string} catalogBoxId
 * @param {{ tradeEligible?: boolean; consumedReason?: string }} patch
 * @param {CatalogMarket} [market]
 */
export function patchCatalogBoxSync(symbol, catalogBoxId, patch, market = "us") {
  const cat = readSymbolCatalogSync(symbol, market);
  if (!cat) return null;
  const id = String(catalogBoxId ?? "").trim();
  const i = cat.boxes.findIndex((b) => b.catalogBoxId === id);
  if (i < 0) return null;
  const prev = cat.boxes[i];
  if (patch.tradeEligible === false) {
    cat.boxes[i] = {
      ...prev,
      tradeEligible: false,
      consumedAtMs: Date.now(),
      consumedReason: patch.consumedReason ?? "manual",
    };
  } else if (patch.tradeEligible === true) {
    cat.boxes[i] = {
      ...prev,
      tradeEligible: true,
      consumedAtMs: null,
      consumedReason: null,
    };
  }
  writeSymbolCatalogSync(cat, market);

  const tstore = readBoxRangeStoreSync();
  let tChanged = 0;
  for (let j = 0; j < tstore.boxes.length; j++) {
    if (tstore.boxes[j].catalogBoxId !== id) continue;
    if (patch.tradeEligible === false) {
      tstore.boxes[j] = {
        ...tstore.boxes[j],
        tradeEligible: false,
        state:
          tstore.boxes[j].state === "in_position"
            ? tstore.boxes[j].state
            : "closed",
        updatedAtMs: Date.now(),
      };
      tChanged += 1;
    } else if (patch.tradeEligible === true) {
      tstore.boxes[j] = {
        ...tstore.boxes[j],
        tradeEligible: true,
        updatedAtMs: Date.now(),
      };
      tChanged += 1;
    }
  }
  if (tChanged > 0) writeBoxRangeStoreSync(tstore);

  return cat.boxes[i];
}

/**
 * @param {string} catalogBoxId
 * @param {string} [reason]
 */
export function markCatalogBoxConsumedSync(catalogBoxId, reason = "closed") {
  for (const market of CATALOG_MARKETS) {
    const dir = catalogDir(market);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "_index.json") continue;
      const sym = f.replace(/\.json$/i, "");
      const cat = readSymbolCatalogSync(sym, market);
      if (!cat) continue;
      const i = cat.boxes.findIndex((b) => b.catalogBoxId === catalogBoxId);
      if (i < 0) continue;
      cat.boxes[i] = {
        ...cat.boxes[i],
        tradeEligible: false,
        consumedAtMs: Date.now(),
        consumedReason: reason,
      };
      writeSymbolCatalogSync(cat, market);
      return;
    }
  }
}

/**
 * @param {string} symbol
 * @param {CatalogMarket} [market]
 */
export function listTradeEligibleCatalogBoxesSync(symbol, market = "us") {
  const cat = readSymbolCatalogSync(symbol, market);
  if (!cat) return [];
  return cat.boxes.filter((b) => b.tradeEligible && !b.consumedAtMs);
}
