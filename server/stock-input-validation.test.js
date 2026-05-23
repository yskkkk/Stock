import { describe, expect, it } from "vitest";
import {
  validateAuthCredentials,
  validateAuthEmail,
  validateBithumbCredentialPair,
  validateExchangeApiToken,
} from "./stock-input-validation.js";

const SAMPLE_KEY =
  "L7rVaYfBIc2BDsnlQGfkR93d6DoOAJCw7mJr5Eso";

describe("validateExchangeApiToken", () => {
  it("accepts bithumb-like key", () => {
    const r = validateExchangeApiToken(SAMPLE_KEY, { label: "API Key" });
    expect(r.ok).toBe(true);
  });

  it("rejects korean", () => {
    const r = validateExchangeApiToken("가나다라", { label: "API Key" });
    expect(r.ok).toBe(false);
  });

  it("rejects short", () => {
    const r = validateExchangeApiToken("abc", { label: "API Key" });
    expect(r.ok).toBe(false);
  });
});

describe("validateAuthEmail", () => {
  it("accepts normal email", () => {
    expect(validateAuthEmail("user@example.com").ok).toBe(true);
  });

  it("rejects missing @", () => {
    expect(validateAuthEmail("userexample.com").ok).toBe(false);
  });
});

describe("validateAuthCredentials", () => {
  it("register requires letter and digit", () => {
    expect(
      validateAuthCredentials("a@b.co", "12345678", { register: true }).ok,
    ).toBe(false);
    expect(
      validateAuthCredentials("a@b.co", "pass1234", { register: true }).ok,
    ).toBe(true);
  });
});

describe("validateBithumbCredentialPair", () => {
  it("requires both on first save", () => {
    const r = validateBithumbCredentialPair("", "", { configured: false });
    expect(r.ok).toBe(false);
  });

  it("allows partial update when configured", () => {
    const r = validateBithumbCredentialPair(SAMPLE_KEY, "", {
      configured: true,
    });
    expect(r.ok).toBe(true);
  });
});
