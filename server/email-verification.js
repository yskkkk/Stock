/**
 * 회원가입 이메일 인증번호 발송·검증
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
 */
export async function sendRegistrationVerificationCode(email) {
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

  if (findUserByEmailSync(norm)) {
    const err = new Error("이미 등록된 이메일입니다.");
    err.code = "EMAIL_ALREADY_REGISTERED";
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
  });

  const ttlMin = Math.round(getVerificationTtlMs() / 60_000);
  const subject = "[YSTOCK] 회원가입 이메일 인증번호";
  const text =
    `YSTOCK 회원가입 인증번호입니다.\n\n` +
    `인증번호: ${code}\n` +
    `유효 시간: ${ttlMin}분\n\n` +
    `본인이 요청하지 않았다면 이 메일을 무시하세요.\n` +
    `가입 완료 후 이 주소로 알림을 보낼 수 있습니다.`;

  await sendTransactionalEmail({
    to: norm,
    subject,
    text,
    html:
      `<p>YSTOCK 회원가입 인증번호입니다.</p>` +
      `<p style="font-size:1.35rem;font-weight:700;letter-spacing:0.2em">${code}</p>` +
      `<p>유효 시간: ${ttlMin}분</p>` +
      `<p style="color:#64748b;font-size:0.9rem">본인이 요청하지 않았다면 무시하세요. ` +
      `가입 후 이 이메일로 알림을 받을 수 있습니다.</p>`,
  });

  const out = {
    ok: true,
    expiresInSec: Math.floor(getVerificationTtlMs() / 1000),
  };
  if (process.env.EMAIL_VERIFY_MOCK === "1") {
    return { ...out, devCode: code };
  }
  return out;
}

/**
 * @param {string} email
 * @param {string} code
 * @param {{ consume?: boolean }} [opts]
 */
function matchRegistrationVerificationCode(email, code, opts = {}) {
  const consume = opts.consume !== false;
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
 * 가입 전 인증번호 일치 확인(소모하지 않음)
 * @param {string} email
 * @param {string} code
 */
export function checkRegistrationVerificationCode(email, code) {
  return matchRegistrationVerificationCode(email, code, { consume: false });
}

/**
 * @param {string} email
 * @param {string} code
 */
export function assertRegistrationVerificationCode(email, code) {
  return matchRegistrationVerificationCode(email, code, { consume: true });
}
