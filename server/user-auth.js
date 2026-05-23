/**
 * 이메일·비밀번호 로그인 + httpOnly 세션 쿠키
 */
import crypto from "node:crypto";
import {
  countUsersSync,
  createUserSync,
  findUserByEmailSync,
  findUserByIdSync,
  normalizeUserEmail,
} from "./users-store.js";
import {
  createSessionSync,
  deleteSessionSync,
  getSessionSync,
} from "./user-sessions-store.js";
import { migrateLegacyProgramsToUserSync } from "./live-trade-programs-store.js";
import {
  validateAuthCredentials,
  validateAuthPassword,
} from "./stock-input-validation.js";

const COOKIE_NAME = "stock_session";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function isRegistrationOpen() {
  if (process.env.USER_REGISTRATION_ENABLED === "0") return false;
  if (countUsersSync() === 0) return true;
  return process.env.USER_REGISTRATION_ENABLED === "1";
}

/**
 * @param {string} password
 * @param {string} saltHex
 */
function verifyPassword(password, saltHex, expectedHash) {
  const salt = Buffer.from(saltHex, "hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const got = derived.toString("hex");
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {string} password
 */
export function hashPassword(password) {
  const checked = validateAuthPassword(password, { register: true });
  if (!checked.ok) {
    throw new Error(checked.error);
  }
  const pw = checked.value;
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return {
    passwordHash: derived.toString("hex"),
    passwordSalt: salt.toString("hex"),
  };
}

/**
 * @param {import("express").Request} req
 */
function parseCookies(req) {
  const raw = String(req.headers.cookie ?? "");
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * @param {import("express").Request} req
 */
export function resolveUserFromRequest(req) {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (!sid) return null;
  const session = getSessionSync(sid);
  if (!session) return null;
  const user = findUserByIdSync(session.userId);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    sessionId: session.id,
  };
}

function cookieSecure() {
  return (
    process.env.USER_SESSION_COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * @param {import("express").Response} res
 * @param {string} sessionId
 */
function setSessionCookie(res, sessionId) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(30 * 24 * 60 * 60)}`,
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** @param {import("express").Response} res */
function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (cookieSecure()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/**
 * @param {import("express").Application} app
 */
export function registerUserAuthRoutes(app) {
  app.post("/api/auth/register", (req, res) => {
    try {
      if (!isRegistrationOpen()) {
        res.status(403).json({
          error: "회원가입이 닫혀 있습니다. 관리자에게 문의하세요.",
          code: "REGISTRATION_CLOSED",
        });
        return;
      }
      const cred = validateAuthCredentials(
        req.body?.email,
        req.body?.password,
        { register: true },
      );
      if (!cred.ok) {
        res.status(400).json({ error: cred.error });
        return;
      }
      const email = cred.value.email;
      const { passwordHash, passwordSalt } = hashPassword(cred.value.password);
      const user = createUserSync({ email, passwordHash, passwordSalt });
      const session = createSessionSync(user.id);
      setSessionCookie(res, session.id);
      maybeMigrateLegacyLiveTradeDataSync(user.id);
      res.json({
        ok: true,
        user: { id: user.id, email: user.email },
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const cred = validateAuthCredentials(req.body?.email, req.body?.password);
      if (!cred.ok) {
        res.status(400).json({ error: cred.error });
        return;
      }
      const email = cred.value.email;
      const password = cred.value.password;
      const user = findUserByEmailSync(email);
      if (
        !user ||
        !verifyPassword(password, user.passwordSalt, user.passwordHash)
      ) {
        res.status(401).json({
          error: "이메일 또는 비밀번호가 올바르지 않습니다.",
          code: "INVALID_CREDENTIALS",
        });
        return;
      }
      const session = createSessionSync(user.id);
      setSessionCookie(res, session.id);
      maybeMigrateLegacyLiveTradeDataSync(user.id);
      res.json({
        ok: true,
        user: { id: user.id, email: user.email },
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const user = resolveUserFromRequest(req);
    if (user?.sessionId) deleteSessionSync(user.sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const user = resolveUserFromRequest(req);
    if (!user) {
      res.status(401).json({
        error: "로그인이 필요합니다.",
        code: "AUTH_REQUIRED",
      });
      return;
    }
    res.json({
      user: { id: user.id, email: user.email },
      registrationOpen: isRegistrationOpen(),
    });
  });
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function requireUserAuth(req, res, next) {
  const user = resolveUserFromRequest(req);
  if (!user) {
    res.status(401).json({
      error: "로그인이 필요합니다.",
      code: "AUTH_REQUIRED",
    });
    return;
  }
  req.user = user;
  next();
}

/**
 * 기존 live-trade-programs.json (userId 없음) → 로그인 계정 귀속(1회)
 * @param {string} userId
 */
export function maybeMigrateLegacyLiveTradeDataSync(userId) {
  if (process.env.LIVE_TRADE_LEGACY_MIGRATE !== "1") return;
  migrateLegacyProgramsToUserSync(userId);
}
