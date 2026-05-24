/**
 * 회원가입 이메일 인증번호 (미가입 이메일만, 파일 저장)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUserEmail } from "./users-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const FILE = path.join(DATA_DIR, "email-verifications.json");

const TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 8;

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultStore() {
  return { pending: [] };
}

function readStoreSync() {
  try {
    if (!fs.existsSync(FILE)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!o || typeof o !== "object" || !Array.isArray(o.pending)) {
      return defaultStore();
    }
    const now = Date.now();
    return {
      pending: o.pending
        .map((p) => normalizePending(p))
        .filter(Boolean)
        .filter((p) => p.expiresAtMs > now),
    };
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(FILE, JSON.stringify(store, null, 0), "utf8");
}

/** @param {unknown} raw */
function normalizePending(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const email = normalizeUserEmail(o.email);
  const codeHash = String(o.codeHash ?? "");
  const codeSalt = String(o.codeSalt ?? "");
  const expiresAtMs =
    typeof o.expiresAtMs === "number" && o.expiresAtMs > 0
      ? o.expiresAtMs
      : 0;
  if (!email || !codeHash || !codeSalt || expiresAtMs <= 0) return null;
  return {
    email,
    codeHash,
    codeSalt,
    expiresAtMs,
    attempts:
      typeof o.attempts === "number" && o.attempts >= 0
        ? Math.floor(o.attempts)
        : 0,
    lastSendAtMs:
      typeof o.lastSendAtMs === "number" && o.lastSendAtMs > 0
        ? o.lastSendAtMs
        : Date.now(),
  };
}

export function getVerificationTtlMs() {
  return TTL_MS;
}

export function getPendingVerificationSync(email) {
  const norm = normalizeUserEmail(email);
  return readStoreSync().pending.find((p) => p.email === norm) ?? null;
}

/**
 * @param {{ email: string; codeHash: string; codeSalt: string; expiresAtMs: number; lastSendAtMs: number }} entry
 */
export function upsertPendingVerificationSync(entry) {
  const email = normalizeUserEmail(entry.email);
  const store = readStoreSync();
  const next = {
    email,
    codeHash: entry.codeHash,
    codeSalt: entry.codeSalt,
    expiresAtMs: entry.expiresAtMs,
    attempts: 0,
    lastSendAtMs: entry.lastSendAtMs,
  };
  store.pending = store.pending.filter((p) => p.email !== email);
  store.pending.push(next);
  writeStoreSync(store);
  return next;
}

export function incrementVerificationAttemptsSync(email) {
  const norm = normalizeUserEmail(email);
  const store = readStoreSync();
  const row = store.pending.find((p) => p.email === norm);
  if (!row) return null;
  row.attempts += 1;
  writeStoreSync(store);
  return row;
}

export function deletePendingVerificationSync(email) {
  const norm = normalizeUserEmail(email);
  const store = readStoreSync();
  const before = store.pending.length;
  store.pending = store.pending.filter((p) => p.email !== norm);
  if (store.pending.length !== before) writeStoreSync(store);
}

export function isVerificationLockedOut(email) {
  const row = getPendingVerificationSync(email);
  if (!row) return false;
  return row.attempts >= MAX_VERIFY_ATTEMPTS;
}
