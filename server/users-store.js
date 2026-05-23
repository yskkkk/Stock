/**
 * 계정 — server/.data/users.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultStore() {
  return { users: [] };
}

function readStoreSync() {
  try {
    if (!fs.existsSync(USERS_FILE)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
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
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 0), "utf8");
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
  return {
    id,
    email,
    passwordHash: String(o.passwordHash ?? ""),
    passwordSalt: String(o.passwordSalt ?? ""),
    createdAtMs:
      typeof o.createdAtMs === "number" && o.createdAtMs > 0
        ? o.createdAtMs
        : Date.now(),
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

/**
 * @param {{ email: string; passwordHash: string; passwordSalt: string }} input
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
  const user = {
    id: randomUUID(),
    email,
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    createdAtMs: Date.now(),
  };
  const store = readStoreSync();
  store.users.push(user);
  writeStoreSync(store);
  return user;
}

export function countUsersSync() {
  return readStoreSync().users.length;
}
