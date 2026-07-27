/**
 * 회원가입·로그인 이메일 인증번호 발송·검증
 */
import crypto from "node:crypto";
import { sendTransactionalEmail, isEmailSendingConfigured } from "./email-sender.js";
import { validateAuthEmail } from "./stock-input-validation.js";
import { findUserByEmailSync } from "./users-store.js";
import {
  deletePendingVerificationSync,
  getPendingVerificationSync,
  getVerificationTtlMs,
  incrementVerificationAttemptsSync,
  isVerificationLockedOut,
  upsertPendingVerificationSync,
} from "./email-verification-store.js";

const SEND_COOLDOWN_MS = 60 * 1000;

/** @typedef {"register" | "login"} EmailVerifyPurpose */

function hashVerificationCode(code, saltHex) {
  return crypto
    .createHash("sha256")
    .update(`${saltHex}:${code}`, "utf8")
    .digest("hex");
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * @param {unknown} purpose
 * @returns {EmailVerifyPurpose}
 */
export function normalizeEmailVerifyPurpose(purpose) {
  return String(purpose ?? "").trim().toLowerCase() === "login"
    ? "login"
    : "register";
}

/**
 * @param {string} code
 */
export function normalizeVerificationCode(code) {
  return String(code ?? "")
    .trim()
    .replace(/\s/g, "");
}

/**
 * @param {string} code
 */
export function validateVerificationCodeFormat(code) {
  const v = normalizeVerificationCode(code);
  if (!/^\d{6}$/.test(v)) {
    return {
      ok: false,
      error: "인증번호 6자리를 입력하세요.",
    };
  }
  return { ok: true, value: v };
}

/**
 * @param {string} email
 * @param {EmailVerifyPurpose | string} [purpose]
 */
export async function sendEmailVerificationCode(email, purpose = "register") {
  if (!isEmailSendingConfigured()) {
    const err = new Error(
      "이메일 발송이 설정되지 않았습니다. 관리자에게 SMTP 설정을 요청하세요.",
    );
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const checked = validateAuthEmail(email);
  if (!checked.ok) {
    const err = new Error(checked.error);
    err.code = "INVALID_EMAIL";
    throw err;
  }
  const norm = checked.value;
  const kind = normalizeEmailVerifyPurpose(purpose);
  const existing = findUserByEmailSync(norm);

  if (kind === "register") {
    if (existing) {
      const err = new Error("이미 등록된 이메일입니다.");
      err.code = "EMAIL_ALREADY_REGISTERED";
      throw err;
    }
  } else if (!existing) {
    const err = new Error("가입된 이메일이 아닙니다.");
    err.code = "EMAIL_NOT_REGISTERED";
    throw err;
  }

  const prev = getPendingVerificationSync(norm);
  const now = Date.now();
  if (prev && now - prev.lastSendAtMs < SEND_COOLDOWN_MS) {
    const err = new Error("잠시 후 다시 인증번호를 요청하세요.");
    err.code = "SEND_COOLDOWN";
    err.retryAfterSec = Math.ceil(
      (SEND_COOLDOWN_MS - (now - prev.lastSendAtMs)) / 1000,
    );
    throw err;
  }

  const code = generateSixDigitCode();
  const codeSalt = crypto.randomBytes(16).toString("hex");
  const codeHash = hashVerificationCode(code, codeSalt);
  const expiresAtMs = now + getVerificationTtlMs();

  upsertPendingVerificationSync({
    email: norm,
    codeHash,
    codeSalt,
    expiresAtMs,
    lastSendAtMs: now,
    purpose: kind,
  });

  const ttlMin = Math.round(getVerificationTtlMs() / 60_000);
  const subject =
    kind === "login"
      ? "[YSTOCK] 로그인 이메일 인증번호"
      : "[YSTOCK] 회원가입 이메일 인증번호";
  const lead =
    kind === "login"
      ? "YSTOCK 로그인 인증번호입니다."
      : "YSTOCK 회원가입 인증번호입니다.";
  const text =
    `${lead}\n\n` +
    `인증번호: ${code}\n` +
    `유효 시간: ${ttlMin}분\n\n` +
    `본인이 요청하지 않았다면 이 메일을 무시하세요.\n`;

  await sendTransactionalEmail({
    to: norm,
    subject,
    text,
    html:
      `<p>${lead}</p>` +
      `<p style="font-size:1.35rem;font-weight:700;letter-spacing:0.2em">${code}</p>` +
      `<p>유효 시간: ${ttlMin}분</p>` +
      `<p style="color:#64748b;font-size:0.9rem">본인이 요청하지 않았다면 무시하세요.</p>`,
  });

  const out = {
    ok: true,
    purpose: kind,
    expiresInSec: Math.floor(getVerificationTtlMs() / 1000),
  };
  if (process.env.EMAIL_VERIFY_MOCK === "1") {
    return { ...out, devCode: code };
  }
  return out;
}

/**
 * @param {string} email
 */
export async function sendRegistrationVerificationCode(email) {
  return sendEmailVerificationCode(email, "register");
}

/**
 * @param {string} email
 * @param {string} code
 * @param {{ consume?: boolean; purpose?: EmailVerifyPurpose | string }} [opts]
 */
function matchEmailVerificationCode(email, code, opts = {}) {
  const consume = opts.consume !== false;
  const expectedPurpose = opts.purpose
    ? normalizeEmailVerifyPurpose(opts.purpose)
    : null;
  const e = validateAuthEmail(email);
  if (!e.ok) {
    const err = new Error(e.error);
    err.code = "INVALID_EMAIL";
    throw err;
  }
  const c = validateVerificationCodeFormat(code);
  if (!c.ok) {
    const err = new Error(c.error);
    err.code = "INVALID_CODE";
    throw err;
  }

  const norm = e.value;
  if (isVerificationLockedOut(norm)) {
    const err = new Error(
      "인증 시도 횟수를 초과했습니다. 인증번호를 다시 받으세요.",
    );
    err.code = "VERIFY_LOCKED";
    throw err;
  }

  const pending = getPendingVerificationSync(norm);
  if (!pending) {
    const err = new Error("인증번호를 먼저 요청하세요.");
    err.code = "CODE_NOT_SENT";
    throw err;
  }
  if (pending.expiresAtMs <= Date.now()) {
    deletePendingVerificationSync(norm);
    const err = new Error("인증번호가 만료되었습니다. 다시 받으세요.");
    err.code = "CODE_EXPIRED";
    throw err;
  }
  if (
    expectedPurpose &&
    pending.purpose &&
    pending.purpose !== expectedPurpose
  ) {
    const err = new Error(
      expectedPurpose === "login"
        ? "로그인용 인증번호를 다시 받아 주세요."
        : "회원가입용 인증번호를 다시 받아 주세요.",
    );
    err.code = "CODE_PURPOSE_MISMATCH";
    throw err;
  }

  const got = hashVerificationCode(c.value, pending.codeSalt);
  if (got !== pending.codeHash) {
    incrementVerificationAttemptsSync(norm);
    const err = new Error("인증번호가 일치하지 않습니다.");
    err.code = "CODE_MISMATCH";
    throw err;
  }

  if (consume) deletePendingVerificationSync(norm);
  return norm;
}

/**
 * @param {string} email
 * @param {string} code
 * @param {EmailVerifyPurpose | string} [purpose]
 */
export function checkEmailVerificationCode(email, code, purpose) {
  return matchEmailVerificationCode(email, code, {
    consume: false,
    purpose,
  });
}

/**
 * @param {string} email
 * @param {string} code
 * @param {EmailVerifyPurpose | string} [purpose]
 */
export function assertEmailVerificationCode(email, code, purpose) {
  return matchEmailVerificationCode(email, code, {
    consume: true,
    purpose,
  });
}

/**
 * 가입 전 인증번호 일치 확인(소모하지 않음)
 * @param {string} email
 * @param {string} code
 */
export function checkRegistrationVerificationCode(email, code) {
  return checkEmailVerificationCode(email, code, "register");
}

/**
 * @param {string} email
 * @param {string} code
 */
export function assertRegistrationVerificationCode(email, code) {
  return assertEmailVerificationCode(email, code, "register");
}
