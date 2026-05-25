/**
 * 계정 — server/.data/users.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveServerDataDir } from "./data-path.js";

function usersFilePath() {
  return path.join(resolveServerDataDir(), "users.json");
}

function ensureDirSync() {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultStore() {
  return { users: [] };
}

function readStoreSync() {
  try {
    const file = usersFilePath();
    if (!fs.existsSync(file)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!o || typeof o !== "object" || !Array.isArray(o.users)) return defaultStore();
    return {
      users: o.users
        .map((u) => normalizeUser(u))
        .filter(Boolean),
    };
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(usersFilePath(), JSON.stringify(store, null, 0), "utf8");
}

/** @param {unknown} raw */
function normalizeUser(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = String(o.id ?? "").trim();
  const email = String(o.email ?? "")
    .trim()
    .toLowerCase();
  if (!id || !email || !email.includes("@")) return null;
  const createdAtMs =
    typeof o.createdAtMs === "number" && o.createdAtMs > 0
      ? o.createdAtMs
      : Date.now();
  /** 이메일 인증 도입 이전 가입자 — 가입 시각을 인증 완료로 간주 */
  const emailVerifiedAtMs =
    typeof o.emailVerifiedAtMs === "number" && o.emailVerifiedAtMs > 0
      ? o.emailVerifiedAtMs
      : createdAtMs;

  return {
    id,
    email,
    passwordHash: String(o.passwordHash ?? ""),
    passwordSalt: String(o.passwordSalt ?? ""),
    createdAtMs,
    /** 가입 시 이메일 인증 완료 시각 — 알림 수신 주소와 동일(email) */
    emailVerifiedAtMs,
  };
}

export function normalizeUserEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

export function listUsersSync() {
  return readStoreSync().users;
}

export function findUserByEmailSync(email) {
  const norm = normalizeUserEmail(email);
  return readStoreSync().users.find((u) => u.email === norm) ?? null;
}

export function findUserByIdSync(id) {
  const sid = String(id ?? "").trim();
  return readStoreSync().users.find((u) => u.id === sid) ?? null;
}

/** @param {ReturnType<typeof normalizeUser>} user */
export function getUserNotificationEmailSync(user) {
  if (!user?.email || !isUserEmailVerifiedSync(user)) return null;
  return user.email;
}

/**
 * @param {{ email: string; passwordHash: string; passwordSalt: string; emailVerifiedAtMs?: number }} input
 */
export function createUserSync(input) {
  const email = normalizeUserEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("올바른 이메일 주소를 입력하세요.");
  }
  if (findUserByEmailSync(email)) {
    throw new Error("이미 등록된 이메일입니다.");
  }
  if (!input.passwordHash || !input.passwordSalt) {
    throw new Error("비밀번호 해시가 필요합니다.");
  }
  const now = Date.now();
  const user = {
    id: randomUUID(),
    email,
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    createdAtMs: now,
    emailVerifiedAtMs:
      typeof input.emailVerifiedAtMs === "number" &&
      Number.isFinite(input.emailVerifiedAtMs) &&
      input.emailVerifiedAtMs > 0
        ? input.emailVerifiedAtMs
        : now,
  };
  const store = readStoreSync();
  store.users.push(user);
  writeStoreSync(store);
  return user;
}

export function countUsersSync() {
  return readStoreSync().users.length;
}

/** @param {ReturnType<typeof normalizeUser>} user */
export function isUserEmailVerifiedSync(user) {
  return Boolean(
    user &&
      typeof user.emailVerifiedAtMs === "number" &&
      Number.isFinite(user.emailVerifiedAtMs) &&
      user.emailVerifiedAtMs > 0,
  );
}

/**
 * users.json에 emailVerifiedAtMs가 없는 기존 계정 → createdAtMs로 일괄 인증 처리(1회성·멱등)
 * @returns {{ updated: number }}
 */
export function migrateLegacyUsersEmailVerifiedSync() {
  const file = usersFilePath();
  if (!fs.existsSync(file)) return { updated: 0 };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { updated: 0 };
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.users)) {
    return { updated: 0 };
  }
  let updated = 0;
  for (const u of raw.users) {
    if (!u || typeof u !== "object") continue;
    const verified = u.emailVerifiedAtMs;
    if (
      typeof verified === "number" &&
      Number.isFinite(verified) &&
      verified > 0
    ) {
      continue;
    }
    const created =
      typeof u.createdAtMs === "number" && u.createdAtMs > 0
        ? u.createdAtMs
        : Date.now();
    u.emailVerifiedAtMs = created;
    updated += 1;
  }
  if (updated > 0) {
    ensureDirSync();
    fs.writeFileSync(file, JSON.stringify(raw, null, 0), "utf8");
  }
  return { updated };
}
