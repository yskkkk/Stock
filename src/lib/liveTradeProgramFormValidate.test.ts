import { describe, expect, it } from "vitest";
import {
  liveTradeProgramDraftCanSave,
  validateLiveTradeProgramDraft,
} from "./liveTradeProgramFormValidate";

const base = {
  name: "테스트",
  modelId: "m1",
  marketsKr: true,
  marketsUs: false,
  marketsCrypto: false,
  maxOpenPositions: "5",
  orderAmountKrw: "10000",
  orderAmountUsd: "",
};

describe("validateLiveTradeProgramDraft", () => {
  it("accepts valid kr draft", () => {
    const v = validateLiveTradeProgramDraft(base);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.maxOpenPositions).toBe(5);
  });

  it("rejects empty name with message", () => {
    const v = validateLiveTradeProgramDraft({ ...base, name: "  " });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message.length).toBeGreaterThan(0);
  });

  it("requires usd when us market on", () => {
    const v = validateLiveTradeProgramDraft({
      ...base,
      marketsKr: false,
      marketsUs: true,
      orderAmountKrw: "",
    });
    expect(v.ok).toBe(false);
  });

  it("canSave matches validator", () => {
    expect(liveTradeProgramDraftCanSave(base)).toBe(true);
    expect(liveTradeProgramDraftCanSave({ ...base, name: "" })).toBe(false);
  });
});
