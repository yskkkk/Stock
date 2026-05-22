/**
 * 추천 목록(tracker) API 스냅샷 — 디스크에서 즉시 반환 후 백그라운드 갱신
 * server/.data/picks-recommendations-tracker-snapshot.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const FILE = path.join(DATA_DIR, "picks-recommendations-tracker-snapshot.json");

const STALE_MS = (() => {
  const n = Number(process.env.STOCK_REC_TRACKER_SNAPSHOT_STALE_MS ?? 45_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.min(600_000, Math.floor(n)) : 45_000;
})();

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {{ writtenAtMs: number; payload: object } | null} */
export function readRecommendationsTrackerSnapshotSync() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, "utf8");
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    const writtenAtMs =
      typeof o.writtenAtMs === "number" && Number.isFinite(o.writtenAtMs)
        ? o.writtenAtMs
        : 0;
    const payload = o.payload;
    if (!payload || typeof payload !== "object") return null;
    if (!Array.isArray(payload.items)) return null;
    return { writtenAtMs, payload };
  } catch {
    return null;
  }
}

/** @param {object} payload */
export function writeRecommendationsTrackerSnapshotSync(payload) {
  try {
    ensureDirSync();
    const writtenAtMs = Date.now();
    fs.writeFileSync(
      FILE,
      JSON.stringify({ version: 1, writtenAtMs, payload }),
      "utf8",
    );
    return writtenAtMs;
  } catch {
    return null;
  }
}

/** @param {{ writtenAtMs: number }} snap */
export function isRecommendationsTrackerSnapshotStale(snap) {
  if (!snap?.writtenAtMs) return true;
  return Date.now() - snap.writtenAtMs >= STALE_MS;
}

/**
 * @param {object} payload
 * @param {{ writtenAtMs?: number; fromSnapshot?: boolean }} [meta]
 */
export function decorateRecommendationsTrackerResponse(payload, meta = {}) {
  return {
    ...payload,
    snapshotAtMs: meta.writtenAtMs ?? payload.updatedAtMs ?? null,
    fromSnapshot: meta.fromSnapshot === true,
  };
}
