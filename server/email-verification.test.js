import { describe, expect, it, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRegistrationVerificationCode,
  checkRegistrationVerificationCode,
  normalizeVerificationCode,
  validateVerificationCodeFormat,
} from "./email-verification.js";
import { upsertPendingVerificationSync } from "./email-verification-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, ".data", "email-verifications.json");

describe("email verification", () => {
  let hadFile = false;
  let backup = null;

  beforeEach(() => {
    hadFile = fs.existsSync(FILE);
    if (hadFile) backup = fs.readFileSync(FILE, "utf8");
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ pending: [] }), "utf8");
  });

  afterEach(() => {
    if (hadFile && backup != null) fs.writeFileSync(FILE, backup, "utf8");
    else if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  });

  it("normalizes verification code", () => {
    expect(normalizeVerificationCode("12 34 56")).toBe("123456");
    expect(validateVerificationCodeFormat("123456").ok).toBe(true);
    expect(validateVerificationCodeFormat("12345").ok).toBe(false);
  });

  it("accepts matching code and rejects mismatch", () => {
    const emailOk = "verify-ok@example.com";
    const emailBad = "verify-bad@example.com";
    const code = "482910";
    const salt = "testsalt";
    const codeHash = crypto
      .createHash("sha256")
      .update(`${salt}:${code}`, "utf8")
      .digest("hex");
    const base = {
      codeHash,
      codeSalt: salt,
      expiresAtMs: Date.now() + 60_000,
      lastSendAtMs: Date.now(),
    };
    upsertPendingVerificationSync({ ...base, email: emailOk });
    upsertPendingVerificationSync({ ...base, email: emailBad });
    expect(assertRegistrationVerificationCode(emailOk, code)).toBe(emailOk);
    expect(() =>
      assertRegistrationVerificationCode(emailBad, "000000"),
    ).toThrow(/일치하지/);
  });

  it("check leaves pending until assert consumes", () => {
    const email = "check-then-assert@example.com";
    const code = "112233";
    const salt = "testsalt2";
    const codeHash = crypto
      .createHash("sha256")
      .update(`${salt}:${code}`, "utf8")
      .digest("hex");
    upsertPendingVerificationSync({
      email,
      codeHash,
      codeSalt: salt,
      expiresAtMs: Date.now() + 60_000,
      lastSendAtMs: Date.now(),
    });
    expect(checkRegistrationVerificationCode(email, code)).toBe(email);
    expect(assertRegistrationVerificationCode(email, code)).toBe(email);
    expect(() => assertRegistrationVerificationCode(email, code)).toThrow();
  });
});
