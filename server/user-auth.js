/**
 * 이메일·비밀번호 로그인 + httpOnly 세션 쿠키
 */
import crypto from "node:crypto";
import {
  countUsersSync,
  createUserSync,
  findUserByEmailSync,
  findUserByIdSync,
  isUserEmailVerifiedSync,
  migrateLegacyUsersEmailVerifiedSync,
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
import {
  assertRegistrationVerificationCode,
  checkRegistrationVerificationCode,
  sendRegistrationVerificationCode,
} from "./email-verification.js";
import { isEmailSendingConfigured } from "./email-sender.js";
import { liveTradeLogInfo } from "./live-trade-log.js";

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
 * @param {string} userId
 * @param {string} password
 */
export function verifyUserAccountPasswordSync(userId, password) {
  const user = findUserByIdSync(userId);
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const checked = validateAuthPassword(password);
  if (!checked.ok) return false;
  return verifyPassword(checked.value, user.passwordSalt, user.passwordHash);
}

/**
 * @param {string} userId
 * @param {unknown} password
 */
export function assertUserAccountPassword(userId, password) {
  const pw = String(password ?? "").trim();
  if (!pw) {
    const err = new Error("계정 비밀번호를 입력하세요.");
    err.code = "ACCOUNT_PASSWORD_REQUIRED";
    throw err;
  }
  if (!verifyUserAccountPasswordSync(userId, pw)) {
    const err = new Error("계정 비밀번호가 올바르지 않습니다.");
    err.code = "INVALID_ACCOUNT_PASSWORD";
    throw err;
  }
  return pw;
}

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
  const legacyEmail = migrateLegacyUsersEmailVerifiedSync();
  if (legacyEmail.updated > 0) {
    liveTradeLogInfo(
      `[auth] 기존 계정 ${legacyEmail.updated}건 이메일 인증 완료 처리`,
    );
  }

  app.post("/api/auth/email/send-code", async (req, res) => {
    try {
      if (!isRegistrationOpen()) {
        res.status(403).json({
          error: "회원가입이 닫혀 있습니다. 관리자에게 문의하세요.",
          code: "REGISTRATION_CLOSED",
        });
        return;
      }
      if (!isEmailSendingConfigured()) {
        res.status(503).json({
          error:
            "이메일 발송이 설정되지 않았습니다. 관리자에게 SMTP 설정을 요청하세요.",
          code: "EMAIL_NOT_CONFIGURED",
        });
        return;
      }
      const result = await sendRegistrationVerificationCode(req.body?.email);
      res.json(result);
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
      let status = 400;
      if (code === "EMAIL_ALREADY_REGISTERED") status = 409;
      if (code === "SEND_COOLDOWN") status = 429;
      if (code === "EMAIL_NOT_CONFIGURED") status = 503;
      res.status(status).json({
        error: e instanceof Error ? e.message : String(e),
        code,
        retryAfterSec:
          e && typeof e === "object" && "retryAfterSec" in e
            ? Number(e.retryAfterSec)
            : undefined,
      });
    }
  });

  app.post("/api/auth/email/verify-code", (req, res) => {
    try {
      if (!isRegistrationOpen()) {
        res.status(403).json({
          error: "회원가입이 닫혀 있습니다. 관리자에게 문의하세요.",
          code: "REGISTRATION_CLOSED",
        });
        return;
      }
      checkRegistrationVerificationCode(
        req.body?.email,
        req.body?.verificationCode ?? req.body?.code,
      );
      res.json({ ok: true });
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
      const status =
        code === "CODE_MISMATCH" || code === "VERIFY_LOCKED" ? 401 : 400;
      res.status(status).json({
        error: e instanceof Error ? e.message : String(e),
        code,
      });
    }
  });

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
      let verifiedEmail;
      try {
        verifiedEmail = assertRegistrationVerificationCode(
          cred.value.email,
          req.body?.verificationCode ?? req.body?.code,
        );
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
        const status =
          code === "CODE_MISMATCH" || code === "VERIFY_LOCKED" ? 401 : 400;
        res.status(status).json({
          error: e instanceof Error ? e.message : String(e),
          code,
        });
        return;
      }
      if (verifiedEmail !== cred.value.email) {
        res.status(400).json({ error: "이메일이 인증 정보와 일치하지 않습니다." });
        return;
      }
      const email = cred.value.email;
      const { passwordHash, passwordSalt } = hashPassword(cred.value.password);
      const user = createUserSync({
        email,
        passwordHash,
        passwordSalt,
        emailVerifiedAtMs: Date.now(),
      });
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

  app.post("/api/auth/verify-password", requireUserAuth, (req, res) => {
    try {
      assertUserAccountPassword(req.user.id, req.body?.password);
      res.json({ ok: true });
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
      const status = code === "INVALID_ACCOUNT_PASSWORD" ? 401 : 400;
      res.status(status).json({
        error: e instanceof Error ? e.message : String(e),
        code,
      });
    }
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
    const row = findUserByIdSync(user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: isUserEmailVerifiedSync(row),
      },
      registrationOpen: isRegistrationOpen(),
      emailVerificationRequired: isRegistrationOpen(),
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
 * userId 없는 실매매·시뮬 프로그램 → 로그인 계정 귀속(멱등)
 * @param {string} userId
 */
export function maybeMigrateLegacyLiveTradeDataSync(userId) {
  const user = findUserByIdSync(userId);
  migrateLegacyProgramsToUserSync(userId, user?.email);
}
