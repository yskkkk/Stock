/**
 * 추천 이력 승률 기반 기술 점수 가중치 오버라이드
 * server/.data/picks-tech-weights.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNAL_SCORE_WEIGHT } from "./technical-default-weights.js";

const SIGNAL_IDS = Object.keys(SIGNAL_SCORE_WEIGHT);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const WEIGHTS_FILE = path.join(DATA_DIR, "picks-tech-weights.json");

const MIN_W = 0;
const MAX_W = 4;

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {typeof SIGNAL_SCORE_WEIGHT} */
export function getDefaultSignalScoreWeights() {
  return { ...SIGNAL_SCORE_WEIGHT };
}

/** @returns {{ weights?: Record<string, number>; revision?: number; updatedAtMs?: number; lastBaselineWinRatePct?: number | null } | null} */
function readStoreSync() {
  try {
    if (!fs.existsSync(WEIGHTS_FILE)) return null;
    const o = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

function writeStoreSync(data) {
  ensureDirSync();
  fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(data, null, 0), "utf8");
}

/** @param {Record<string, unknown>} raw */
function sanitizeWeights(raw) {
  const def = getDefaultSignalScoreWeights();
  const out = { ...def };
  if (!raw || typeof raw !== "object") return out;
  for (const id of SIGNAL_IDS) {
    const v = raw[id];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[id] = Math.max(MIN_W, Math.min(MAX_W, Math.round(v)));
  }
  return out;
}

/** @returns {typeof SIGNAL_SCORE_WEIGHT} */
export function getActiveSignalScoreWeightsSync() {
  const store = readStoreSync();
  const patch = store?.weights;
  if (!patch || typeof patch !== "object") return getDefaultSignalScoreWeights();
  return sanitizeWeights(patch);
}

export function getTechWeightsRevisionSync() {
  const store = readStoreSync();
  return typeof store?.revision === "number" && store.revision >= 0
    ? store.revision
    : 0;
}

export function getTechWeightsMetaSync() {
  const store = readStoreSync();
  return {
    revision: getTechWeightsRevisionSync(),
    updatedAtMs:
      typeof store?.updatedAtMs === "number" && Number.isFinite(store.updatedAtMs)
        ? store.updatedAtMs
        : null,
    lastBaselineWinRatePct:
      typeof store?.lastBaselineWinRatePct === "number" &&
      Number.isFinite(store.lastBaselineWinRatePct)
        ? store.lastBaselineWinRatePct
        : null,
  };
}

/** @param {typeof SIGNAL_SCORE_WEIGHT} weights */
export function sumTechScoreWeights(weights) {
  let sum = 0;
  for (const id of SIGNAL_IDS) {
    const w = weights[id];
    if (typeof w === "number" && Number.isFinite(w)) sum += w;
  }
  return sum;
}

export function getMaxTechScoreSync() {
  return sumTechScoreWeights(getActiveSignalScoreWeightsSync());
}

/**
 * @param {typeof SIGNAL_SCORE_WEIGHT} weights
 * @param {{ baselineWinRatePct?: number | null }} [meta]
 */
export function applyTechWeights(weights, meta = {}) {
  const sanitized = sanitizeWeights(weights);
  const prev = readStoreSync();
  const revision =
    (typeof prev?.revision === "number" && prev.revision >= 0 ? prev.revision : 0) + 1;
  writeStoreSync({
    weights: sanitized,
    revision,
    updatedAtMs: Date.now(),
    lastBaselineWinRatePct:
      meta.baselineWinRatePct != null && Number.isFinite(meta.baselineWinRatePct)
        ? meta.baselineWinRatePct
        : (prev?.lastBaselineWinRatePct ?? null),
  });
  return { weights: sanitized, revision };
}

export function resetTechWeightsSync() {
  try {
    if (fs.existsSync(WEIGHTS_FILE)) fs.unlinkSync(WEIGHTS_FILE);
  } catch {
    /* ignore */
  }
}
