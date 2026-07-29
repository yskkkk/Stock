/**
 * 토스 계좌 — 월별 비중 유지 매수 스케줄 (사용자별)
 */
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STORE_FILE = "toss-rebalance-schedules.json";

function defaultStore() {
  return { users: /** @type {Record<string, object>} */ ({}) };
}

function readStoreSync() {
  return readJsonStoreSync(
    STORE_FILE,
    (parsed) => {
      if (!parsed?.users || typeof parsed.users !== "object") return defaultStore();
      return parsed;
    },
    defaultStore,
  );
}

function writeStoreSync(store) {
  writeJsonStoreSync(STORE_FILE, store, (data) => `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * @param {unknown} n
 * @param {number} lo
 * @param {number} hi
 * @param {number} fallback
 */
function clampInt(n, lo, hi, fallback) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * @param {unknown} row
 */
function normalizeSchedule(row) {
  if (!row || typeof row !== "object") return null;
  const marketsRaw = Array.isArray(/** @type {{ markets?: unknown }} */ (row).markets)
    ? /** @type {{ markets: unknown[] }} */ (row).markets
    : ["kr", "us"];
  const markets = [...new Set(marketsRaw.map((m) => String(m).toLowerCase()).filter((m) => m === "kr" || m === "us"))];
  return {
    enabled: Boolean(/** @type {{ enabled?: unknown }} */ (row).enabled),
    dayOfMonth: clampInt(/** @type {{ dayOfMonth?: unknown }} */ (row).dayOfMonth, 1, 28, 1),
    mode: "proportional_buy",
    markets: markets.length ? markets : ["kr", "us"],
    cashUsePct: clampInt(/** @type {{ cashUsePct?: unknown }} */ (row).cashUsePct, 1, 100, 100),
    lastRunYmd: String(/** @type {{ lastRunYmd?: unknown }} */ (row).lastRunYmd ?? "").trim() || null,
    lastRunAtMs:
      Number(/** @type {{ lastRunAtMs?: unknown }} */ (row).lastRunAtMs) || null,
    lastResult:
      /** @type {{ lastResult?: unknown }} */ (row).lastResult &&
      typeof /** @type {{ lastResult?: unknown }} */ (row).lastResult === "object"
        ? /** @type {{ lastResult: object }} */ (row).lastResult
        : null,
    updatedAtMs: Number(/** @type {{ updatedAtMs?: unknown }} */ (row).updatedAtMs) || null,
  };
}

/**
 * @param {string} userId
 */
export function getTossRebalanceScheduleSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  return normalizeSchedule(readStoreSync().users[uid]);
}

/**
 * @returns {string[]}
 */
export function listTossRebalanceScheduleUserIdsSync() {
  const users = readStoreSync().users ?? {};
  return Object.keys(users).filter((uid) => {
    const s = normalizeSchedule(users[uid]);
    return Boolean(s?.enabled);
  });
}

/**
 * @param {string} userId
 * @param {object} patch
 */
export function upsertTossRebalanceScheduleSync(userId, patch) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");

  const store = readStoreSync();
  const prev = normalizeSchedule(store.users[uid]) ?? {
    enabled: false,
    dayOfMonth: 1,
    mode: "proportional_buy",
    markets: ["kr", "us"],
    cashUsePct: 100,
    lastRunYmd: null,
    lastRunAtMs: null,
    lastResult: null,
    updatedAtMs: null,
  };

  const next = normalizeSchedule({
    ...prev,
    ...patch,
    markets: patch.markets !== undefined ? patch.markets : prev.markets,
    enabled: patch.enabled !== undefined ? patch.enabled : prev.enabled,
    dayOfMonth: patch.dayOfMonth !== undefined ? patch.dayOfMonth : prev.dayOfMonth,
    cashUsePct: patch.cashUsePct !== undefined ? patch.cashUsePct : prev.cashUsePct,
    lastRunYmd: patch.lastRunYmd !== undefined ? patch.lastRunYmd : prev.lastRunYmd,
    lastRunAtMs: patch.lastRunAtMs !== undefined ? patch.lastRunAtMs : prev.lastRunAtMs,
    lastResult: patch.lastResult !== undefined ? patch.lastResult : prev.lastResult,
    updatedAtMs: Date.now(),
  });

  if (!next) throw new Error("스케줄 저장에 실패했습니다.");
  store.users[uid] = next;
  writeStoreSync(store);
  return next;
}
