/**
 * 사용자 거래소 API 키 — CREDENTIALS_MASTER_KEY 로 AES-256-GCM 저장
 */
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function masterKeyBuf() {
  const raw = String(process.env.CREDENTIALS_MASTER_KEY ?? "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isCredentialsCryptoReady() {
  return masterKeyBuf() != null;
}

export function requireCredentialsCrypto() {
  if (!isCredentialsCryptoReady()) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY가 설정되지 않았습니다. server/.env 에 32바이트 hex 또는 임의 문자열을 넣고 서버를 재시작하세요.",
    );
  }
}

/**
 * @param {string} plain
 * @returns {string} base64(iv|tag|ciphertext)
 */
export function encryptSecret(plain) {
  requireCredentialsCrypto();
  const key = /** @type {Buffer} */ (masterKeyBuf());
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain ?? ""), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} packed
 * @returns {string}
 */
export function decryptSecret(packed) {
  requireCredentialsCrypto();
  const key = /** @type {Buffer} */ (masterKeyBuf());
  const buf = Buffer.from(String(packed ?? ""), "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("암호화 credential 형식이 올바르지 않습니다.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
