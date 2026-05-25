import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveServerDataDir } from "../data-path.js";
import { findMergeBoxIndex } from "./merge.js";

function stateFilePath() {
  return path.join(resolveServerDataDir(), "box-range-state.json");
}

/**
 * @typedef {"idle"|"armed"|"in_position"|"closed"} BoxRangeState
 * @typedef {{
 *   boxId: string;
 *   programId: string;
 *   userId: string;
 *   symbol: string;
 *   timeframe: "1h"|"4h"|"1d";
 *   top: number;
 *   bottom: number;
 *   mid: number;
 *   leftTime: number;
 *   rightTime: number;
 *   state: BoxRangeState;
 *   armedAtMs: number | null;
 *   breakAtMs: number | null;
 *   buyTradeId: string | null;
 *   lotQty: number;
 *   entryPrice: number | null;
 *   buyAtMs: number | null;
 *   updatedAtMs: number;
 *   catalogBoxId: string | null;
 *   catalogMarket: "us" | "kr" | null;
 *   tradeEligible: boolean;
 *   midNotifiedAtMs: number | null;
 * }} BoxRangeRecord
 */

function defaultStore() {
  return { boxes: [] };
}

function normalizeBox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const boxId = String(o.boxId ?? "").trim();
  const programId = String(o.programId ?? "").trim();
  const userId = String(o.userId ?? "").trim();
  const symbol = String(o.symbol ?? "").trim().toUpperCase();
  const tf = String(o.timeframe ?? "").trim();
  if (!boxId || !programId || !symbol || !["1h", "4h", "1d"].includes(tf)) {
    return null;
  }
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
  const st = String(o.state ?? "idle");
  /** @type {BoxRangeState} */
  const state =
    st === "armed" ||
    st === "in_position" ||
    st === "closed"
      ? st
      : "idle";
  return {
    boxId,
    programId,
    userId,
    symbol,
    timeframe: /** @type {"1h"|"4h"|"1d"} */ (tf),
    top,
    bottom,
    mid,
    leftTime: Number(o.leftTime) || 0,
    rightTime: Number(o.rightTime) || 0,
    state,
    armedAtMs:
      typeof o.armedAtMs === "number" && o.armedAtMs > 0 ? o.armedAtMs : null,
    breakAtMs:
      typeof o.breakAtMs === "number" && o.breakAtMs > 0 ? o.breakAtMs : null,
    buyTradeId:
      typeof o.buyTradeId === "string" && o.buyTradeId.trim()
        ? o.buyTradeId.trim()
        : null,
    lotQty:
      typeof o.lotQty === "number" && Number.isFinite(o.lotQty) && o.lotQty >= 0
        ? o.lotQty
        : 0,
    entryPrice:
      typeof o.entryPrice === "number" &&
      Number.isFinite(o.entryPrice) &&
      o.entryPrice > 0
        ? o.entryPrice
        : null,
    buyAtMs:
      typeof o.buyAtMs === "number" && o.buyAtMs > 0 ? o.buyAtMs : null,
    updatedAtMs:
      typeof o.updatedAtMs === "number" && o.updatedAtMs > 0
        ? o.updatedAtMs
        : Date.now(),
    catalogBoxId:
      typeof o.catalogBoxId === "string" && o.catalogBoxId.trim()
        ? o.catalogBoxId.trim()
        : null,
    catalogMarket:
      o.catalogMarket === "kr"
        ? "kr"
        : o.catalogMarket === "us"
          ? "us"
          : null,
    tradeEligible: o.tradeEligible !== false,
    midNotifiedAtMs:
      typeof o.midNotifiedAtMs === "number" && o.midNotifiedAtMs > 0
        ? o.midNotifiedAtMs
        : null,
  };
}

export function readBoxRangeStoreSync() {
  try {
    const file = stateFilePath();
    if (!fs.existsSync(file)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!o || !Array.isArray(o.boxes)) return defaultStore();
    return {
      boxes: o.boxes.map(normalizeBox).filter(Boolean),
    };
  } catch {
    return defaultStore();
  }
}

export function writeBoxRangeStoreSync(store) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = stateFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
  fs.renameSync(tmp, file);
}

/**
 * @param {string} programId
 * @param {string} [symbol]
 */
export function listBoxesForProgramSync(programId, symbol = null) {
  const pid = String(programId ?? "").trim();
  const sym = symbol ? String(symbol).trim().toUpperCase() : null;
  return readBoxRangeStoreSync().boxes.filter((b) => {
    if (b.programId !== pid) return false;
    if (sym && b.symbol !== sym) return false;
    return true;
  });
}

/**
 * @param {string} userId
 * @param {string} symbol
 */
export function listBoxesForChartOverlaySync(userId, symbol) {
  const uid = String(userId ?? "").trim();
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!uid || !sym) return [];
  return readBoxRangeStoreSync().boxes.filter(
    (b) => b.userId === uid && b.symbol === sym && b.state !== "closed",
  );
}

/**
 * @param {number} barSec
 */
function barSecondsForTf(timeframe) {
  if (timeframe === "1h") return 3600;
  if (timeframe === "4h") return 4 * 3600;
  return 86400;
}

/**
 * @param {{
 *   programId: string;
 *   userId: string;
 *   symbol: string;
 *   timeframe: "1h"|"4h"|"1d";
 *   top: number;
 *   bottom: number;
 *   mid: number;
 *   leftTime: number;
 *   rightTime: number;
 *   catalogBoxId?: string | null;
 *   catalogMarket?: "us" | "kr" | null;
 *   tradeEligible?: boolean;
 * }} detected
 */
/** 탐지·병합·매매는 timeframe 단위로 완전 분리(1h/4h/1d 겹쳐도 각각 독립 박스). */
export function upsertDetectedBoxSync(detected) {
  const store = readBoxRangeStoreSync();
  const catalogId = String(detected.catalogBoxId ?? "").trim() || null;
  if (catalogId) {
    const dup = store.boxes.find(
      (b) =>
        b.programId === detected.programId &&
        b.catalogBoxId === catalogId &&
        b.state !== "closed",
    );
    if (dup) return dup;
  }
  const same = store.boxes.filter(
    (b) =>
      b.programId === detected.programId &&
      b.symbol === detected.symbol &&
      b.timeframe === detected.timeframe &&
      b.state !== "closed" &&
      !b.catalogBoxId,
  );
  const barSec = barSecondsForTf(detected.timeframe);
  const idx = findMergeBoxIndex(
    { ...detected, state: "idle" },
    same,
    barSec,
  );
  const now = Date.now();
  if (idx >= 0) {
    const globalIdx = store.boxes.findIndex(
      (b) => b.boxId === same[idx].boxId,
    );
    if (globalIdx < 0) return same[idx];
    const prev = store.boxes[globalIdx];
    store.boxes[globalIdx] = {
      ...prev,
      top: Math.max(prev.top, detected.top),
      bottom: Math.min(prev.bottom, detected.bottom),
      mid: (Math.max(prev.top, detected.top) + Math.min(prev.bottom, detected.bottom)) / 2,
      leftTime: Math.min(prev.leftTime, detected.leftTime),
      rightTime: Math.max(prev.rightTime, detected.rightTime),
      updatedAtMs: now,
    };
    writeBoxRangeStoreSync(store);
    return store.boxes[globalIdx];
  }

  const box = {
    boxId: randomUUID(),
    programId: detected.programId,
    userId: detected.userId,
    symbol: detected.symbol,
    timeframe: detected.timeframe,
    top: detected.top,
    bottom: detected.bottom,
    mid: detected.mid,
    leftTime: detected.leftTime,
    rightTime: detected.rightTime,
    state: /** @type {BoxRangeState} */ ("idle"),
    armedAtMs: null,
    breakAtMs: null,
    buyTradeId: null,
    lotQty: 0,
    entryPrice: null,
    buyAtMs: null,
    updatedAtMs: now,
    catalogBoxId: catalogId,
    catalogMarket:
      detected.catalogMarket === "kr"
        ? "kr"
        : detected.catalogMarket === "us"
          ? "us"
          : null,
    tradeEligible: detected.tradeEligible !== false,
    midNotifiedAtMs: null,
  };
  store.boxes.push(box);
  if (store.boxes.length > 800) {
    store.boxes = store.boxes
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, 600);
  }
  writeBoxRangeStoreSync(store);
  return box;
}

/**
 * @param {string} boxId
 * @param {Partial<BoxRangeRecord>} patch
 */
export function patchBoxSync(boxId, patch) {
  const id = String(boxId ?? "").trim();
  if (!id) return null;
  const store = readBoxRangeStoreSync();
  const i = store.boxes.findIndex((b) => b.boxId === id);
  if (i < 0) return null;
  store.boxes[i] = {
    ...store.boxes[i],
    ...patch,
    boxId: store.boxes[i].boxId,
    updatedAtMs: Date.now(),
  };
  writeBoxRangeStoreSync(store);
  return store.boxes[i];
}

/** @param {string} programId */
export function countOpenBoxLotsSync(programId) {
  const pid = String(programId ?? "").trim();
  return readBoxRangeStoreSync().boxes.filter(
    (b) => b.programId === pid && b.state === "in_position",
  ).length;
}
