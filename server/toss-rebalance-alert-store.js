/**
 * 토스 계좌 — 성장/가치 비중 괴리 알림 설정 (사용자별 파일)
 * server/.data/toss-rebalance-alert/{userId}.json
 *
 * 빗썸·기타 거래소와 무관. 계좌(userId)마다 독립.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "./data-path.js";
import { parseJsonText } from "./store-json.js";

/** 기본 괴리 임계값 (percentage points) */
export const DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT = 5;

/** @typedef {{
 *   enabled: boolean;
 *   thresholdPctPoints: number;
 *   updatedAtMs: number | null;
 * }} TossRebalanceAlertSettings */

function alertRoot() {
  return path.join(resolveServerDataDir(), "toss-rebalance-alert");
}

function ensureRoot() {
  const root = alertRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
}

/**
 * @param {string} userId
 */
function storePath(userId) {
  const id = String(userId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  return path.join(alertRoot(), `${id || "anon"}.json`);
}

/**
 * @param {unknown} n
 * @param {number} fallback
 */
export function clampTossRebalanceDriftThreshold(n, fallback = DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  // 0.5 ~ 50 %p — UI에서 조정 가능, 기본 5
  return Math.min(50, Math.max(0.5, Math.round(v * 10) / 10));
}

/**
 * @returns {TossRebalanceAlertSettings}
 */
export function defaultTossRebalanceAlertSettings() {
  return {
    enabled: false,
    thresholdPctPoints: DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT,
    updatedAtMs: null,
  };
}

/**
 * @param {unknown} raw
 * @returns {TossRebalanceAlertSettings}
 */
function normalizeSettings(raw) {
  const base = defaultTossRebalanceAlertSettings();
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  return {
    enabled: Boolean(o.enabled),
    thresholdPctPoints: clampTossRebalanceDriftThreshold(
      o.thresholdPctPoints,
      DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT,
    ),
    updatedAtMs:
      typeof o.updatedAtMs === "number" && Number.isFinite(o.updatedAtMs)
        ? o.updatedAtMs
        : null,
  };
}

/**
 * @param {string} userId
 * @returns {TossRebalanceAlertSettings}
 */
export function readTossRebalanceAlertSettingsSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return defaultTossRebalanceAlertSettings();
  try {
    const file = storePath(uid);
    if (!fs.existsSync(file)) return defaultTossRebalanceAlertSettings();
    return normalizeSettings(parseJsonText(fs.readFileSync(file, "utf8")));
  } catch {
    return defaultTossRebalanceAlertSettings();
  }
}

/**
 * @param {string} userId
 * @param {TossRebalanceAlertSettings} data
 */
function writeSettingsSync(userId, data) {
  ensureRoot();
  const file = storePath(userId);
  const tmp = `${file}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * @param {string} userId
 * @param {{ enabled?: unknown; thresholdPctPoints?: unknown }} patch
 * @returns {{ ok: true; settings: TossRebalanceAlertSettings } | { ok: false; error: string }}
 */
export function updateTossRebalanceAlertSettingsSync(userId, patch) {
  const uid = String(userId ?? "").trim();
  if (!uid) return { ok: false, error: "user-required" };
  const cur = readTossRebalanceAlertSettingsSync(uid);
  const next = {
    enabled:
      patch.enabled === undefined ? cur.enabled : Boolean(patch.enabled),
    thresholdPctPoints:
      patch.thresholdPctPoints === undefined
        ? cur.thresholdPctPoints
        : clampTossRebalanceDriftThreshold(
            patch.thresholdPctPoints,
            cur.thresholdPctPoints,
          ),
    updatedAtMs: Date.now(),
  };
  writeSettingsSync(uid, next);
  return { ok: true, settings: next };
}
