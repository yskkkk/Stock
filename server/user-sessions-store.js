/**
 * httpOnly 세션 — server/.data/user-sessions.json
 */
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const SESSIONS_FILE = "user-sessions.json";

/** 기본 로그인 세션 유효 시간 — 30일 */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 사용자 안내 문구에만 쓰는 분 수(실제 세션 TTL과 무관) */
export const AUTH_VALIDITY_MESSAGE_MINUTES = 1;

function defaultStore() {
  return { sessions: [] };
}

function readStoreSync() {
  return readJsonStoreSync(
    SESSIONS_FILE,
    (raw) => {
      if (!raw || typeof raw !== "object") return defaultStore();
      const o = /** @type {Record<string, unknown>} */ (raw);
      const sessions = Array.isArray(o.sessions) ? o.sessions.filter(Boolean) : [];
      return { sessions };
    },
    defaultStore,
  );
}

function writeStoreSync(store) {
  writeJsonStoreSync(SESSIONS_FILE, store);
}

/**
 * 로그인 세션 TTL(ms). 기본 30일.
 * `USER_SESSION_TTL_MINUTES`가 있으면 우선, 없으면 `USER_SESSION_TTL_DAYS`(기본 30).
 */
export function sessionTtlMs() {
  const minutesRaw = process.env.USER_SESSION_TTL_MINUTES;
  if (minutesRaw != null && String(minutesRaw).trim() !== "") {
    const m = Number(minutesRaw);
    if (Number.isFinite(m) && m > 0) {
      return Math.min(365 * 24 * 60, m) * 60 * 1000;
    }
  }
  const n = Number(process.env.USER_SESSION_TTL_DAYS ?? "30");
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TTL_MS;
  return Math.min(365, n) * 24 * 60 * 60 * 1000;
}

/** 실제 세션 TTL의 분 환산(최소 1) */
export function sessionTtlMinutesLabel() {
  return Math.max(1, Math.round(sessionTtlMs() / 60_000));
}

function pruneExpiredSync(store) {
  const now = Date.now();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(
    (s) =>
      s &&
      typeof s.expiresAtMs === "number" &&
      s.expiresAtMs > now &&
      typeof s.userId === "string" &&
      s.userId,
  );
  return store.sessions.length !== before;
}

/**
 * @param {string} userId
 */
export function createSessionSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("userId가 필요합니다.");
  const now = Date.now();
  const session = {
    id: randomBytes(32).toString("hex"),
    userId: uid,
    createdAtMs: now,
    expiresAtMs: now + sessionTtlMs(),
  };
  const store = readStoreSync();
  pruneExpiredSync(store);
  store.sessions.push(session);
  writeStoreSync(store);
  return session;
}

export function getSessionSync(sessionId) {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  const store = readStoreSync();
  const pruned = pruneExpiredSync(store);
  if (pruned) writeStoreSync(store);
  const row = store.sessions.find((s) => s.id === sid);
  if (!row || row.expiresAtMs <= Date.now()) return null;
  return row;
}

export function deleteSessionSync(sessionId) {
  const sid = String(sessionId ?? "").trim();
  const store = readStoreSync();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.id !== sid);
  if (store.sessions.length !== before) writeStoreSync(store);
}

export function deleteSessionsForUserSync(userId) {
  const uid = String(userId ?? "").trim();
  const store = readStoreSync();
  store.sessions = store.sessions.filter((s) => s.userId !== uid);
  writeStoreSync(store);
}

/** @param {string} userId @param {number} max */
export function listSessionIdsForUserSync(userId, max = 20) {
  const uid = String(userId ?? "").trim();
  const store = readStoreSync();
  return store.sessions
    .filter((s) => s.userId === uid && s.expiresAtMs > Date.now())
    .slice(-max)
    .map((s) => s.id);
}

export function newCsrfToken() {
  return randomUUID().replace(/-/g, "");
}
