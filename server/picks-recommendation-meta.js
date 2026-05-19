/**
 * 일자별 추천 이벤트 메타(signalIds·score) — history slim에 없을 때 보강·백필
 * server/.data/picks-recommendation-meta.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kstYmd } from "./picks-history-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const META_FILE = path.join(DATA_DIR, "picks-recommendation-meta.json");

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {Record<string, { signalIds?: string[]; score?: number | null }>} */
function readMetaSync() {
  try {
    if (!fs.existsSync(META_FILE)) return {};
    const o = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function writeMetaSync(meta) {
  ensureDirSync();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 0), "utf8");
}

/**
 * @param {string} date YYYY-MM-DD
 * @param {"kr"|"us"} market
 * @param {string} symbol
 */
export function recommendationMetaKey(date, market, symbol) {
  return `${date}:${market}:${String(symbol ?? "").trim().toUpperCase()}`;
}

/**
 * @param {string} date
 * @param {"kr"|"us"} market
 * @param {{ symbol: string; score?: number; signalIds?: string[] }} pick
 */
export function upsertRecommendationMeta(date, market, pick) {
  const sym = String(pick.symbol ?? "").trim().toUpperCase();
  if (!sym || !date) return;
  const key = recommendationMetaKey(date, market, sym);
  const meta = readMetaSync();
  const prev = meta[key] && typeof meta[key] === "object" ? meta[key] : {};
  const signalIds = Array.isArray(pick.signalIds)
    ? pick.signalIds.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const score =
    typeof pick.score === "number" && Number.isFinite(pick.score) ? Math.round(pick.score) : null;
  meta[key] = {
    signalIds: signalIds.length ? signalIds : prev.signalIds,
    score: score != null ? score : prev.score ?? null,
  };
  writeMetaSync(meta);
}

/**
 * @param {string} date
 * @param {"kr"|"us"} market
 * @param {string} symbol
 */
export function readRecommendationMeta(date, market, symbol) {
  const meta = readMetaSync();
  const hit = meta[recommendationMetaKey(date, market, symbol)];
  return hit && typeof hit === "object" ? hit : null;
}
