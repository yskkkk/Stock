import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveServerDataDir } from "../data-path.js";
import { readBoxRangeStoreSync, writeBoxRangeStoreSync } from "./store.js";
import {
  BOX_RANGE_MERGE_BARS_GAP,
  BOX_RANGE_MERGE_PCT,
  BOX_RANGE_SIMILAR_RANGE_PCT,
} from "./constants.js";
import {
  findMergeBoxIndex,
  priceOverlapPct,
  similarRange,
  timesNearOverlap,
} from "./merge.js";

function catalogDir() {
  return path.join(resolveServerDataDir(), "box-range-catalog", "us");
}

function symbolFilePath(symbol) {
  return path.join(catalogDir(), `${String(symbol).trim().toUpperCase()}.json`);
}

function indexFilePath() {
  return path.join(catalogDir(), "_index.json");
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
 */
export function readSymbolCatalogSync(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  try {
    const file = symbolFilePath(sym);
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
 */
export function writeSymbolCatalogSync(payload) {
  const sym = String(payload.symbol ?? "").trim().toUpperCase();
  if (!sym) return;
  const dir = catalogDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = symbolFilePath(sym);
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
  refreshCatalogIndexSync();
}

/**
 * @param {import("./detect-pro.js").DetectedBox} detected
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {CatalogBox[]} existing
 */
function mergeCatalogDetected(detected, timeframe, existing) {
  const barSec = barSecForTf(timeframe);
  const gap = BOX_RANGE_MERGE_BARS_GAP * barSec;
  for (let j = 0; j < existing.length; j++) {
    const e = existing[j];
    if (e.timeframe !== timeframe) continue;
    const priceOk =
      priceOverlapPct(detected.top, detected.bottom, e.top, e.bottom) >=
        BOX_RANGE_MERGE_PCT ||
      similarRange(
        detected.top,
        detected.bottom,
        e.top,
        e.bottom,
        BOX_RANGE_SIMILAR_RANGE_PCT,
      );
    const timeOk = timesNearOverlap(
      detected.leftTime,
      detected.rightTime,
      e.leftTime,
      e.rightTime,
      gap,
    );
    if (priceOk && timeOk) {
      const mTop = Math.max(e.top, detected.top);
      const mBot = Math.min(e.bottom, detected.bottom);
      existing[j] = {
        ...e,
        top: mTop,
        bottom: mBot,
        mid: (mTop + mBot) * 0.5,
        leftTime: Math.min(e.leftTime, detected.leftTime),
        rightTime: Math.max(e.rightTime, detected.rightTime),
        validBars: Math.max(e.validBars, detected.validBars ?? 0),
        detectedAtMs: Date.now(),
      };
      return;
    }
  }
  existing.push({
    catalogBoxId: randomUUID(),
    timeframe,
    top: detected.top,
    bottom: detected.bottom,
    mid: detected.mid,
    leftTime: detected.leftTime,
    rightTime: detected.rightTime,
    validBars: detected.validBars ?? 0,
    detectedAtMs: Date.now(),
    tradeEligible: true,
    consumedAtMs: null,
    consumedReason: null,
  });
}

/**
 * @param {string} symbol
 * @param {string} name
 * @param {Partial<Record<"1h"|"4h"|"1d", import("./detect-pro.js").DetectedBox[]>>} byTf
 * @param {string | null} scanError
 */
export function upsertSymbolCatalogDetectionsSync(symbol, name, byTf, scanError = null) {
  const sym = String(symbol).trim().toUpperCase();
  const prev = readSymbolCatalogSync(sym);
  /** @type {CatalogBox[]} */
  const boxes = prev ? [...prev.boxes] : [];
  const now = Date.now();
  for (const tf of /** @type {const} */ (["1h", "4h", "1d"])) {
    const list = byTf[tf];
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      mergeCatalogDetected(d, tf, boxes);
    }
  }
  writeSymbolCatalogSync({
    symbol: sym,
    name: name || prev?.name || sym,
    updatedAtMs: now,
    scanError,
    boxes,
  });
}

export function refreshCatalogIndexSync() {
  const dir = catalogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "_index.json");
  /** @type {{ symbol: string; name: string; updatedAtMs: number; eligibleCount: number; boxCount: number }[]} */
  const entries = [];
  for (const f of files) {
    const sym = f.replace(/\.json$/i, "");
    const cat = readSymbolCatalogSync(sym);
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
    updatedAtMs: Date.now(),
    count: entries.length,
    symbols: entries,
  };
  const file = indexFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 0), "utf8");
  fs.renameSync(tmp, file);
  return idx;
}

export function readCatalogIndexSync() {
  try {
    const file = indexFilePath();
    if (!fs.existsSync(file)) return refreshCatalogIndexSync();
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return refreshCatalogIndexSync();
  }
}

/**
 * @param {string} symbol
 * @param {string} catalogBoxId
 * @param {{ tradeEligible?: boolean; consumedReason?: string }} patch
 */
export function patchCatalogBoxSync(symbol, catalogBoxId, patch) {
  const cat = readSymbolCatalogSync(symbol);
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
  writeSymbolCatalogSync(cat);

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
  const dir = catalogDir();
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "_index.json") continue;
    const sym = f.replace(/\.json$/i, "");
    const cat = readSymbolCatalogSync(sym);
    if (!cat) continue;
    const i = cat.boxes.findIndex((b) => b.catalogBoxId === catalogBoxId);
    if (i < 0) continue;
    cat.boxes[i] = {
      ...cat.boxes[i],
      tradeEligible: false,
      consumedAtMs: Date.now(),
      consumedReason: reason,
    };
    writeSymbolCatalogSync(cat);
    return;
  }
}

/**
 * @param {string} symbol
 */
export function listTradeEligibleCatalogBoxesSync(symbol) {
  const cat = readSymbolCatalogSync(symbol);
  if (!cat) return [];
  return cat.boxes.filter((b) => b.tradeEligible && !b.consumedAtMs);
}
