import { describe, expect, it } from "vitest";
import {
  hasDuplicateProgramName,
  liveTradeProgramDraftCanSave,
  validateLiveTradeProgramDraft,
} from "./liveTradeProgramFormValidate";
import { ko } from "../i18n/ko";

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

  it("rejects crypto with stock markets", () => {
    const v = validateLiveTradeProgramDraft({
      ...base,
      marketsKr: true,
      marketsCrypto: true,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toBe(ko.app.liveTradeMarketsStockCryptoExclusive);
    }
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

  it("rejects duplicate program name for same user list", () => {
    const ctx = {
      existingPrograms: [{ id: "p1", name: "YSTOCK" }],
      editingProgramId: null,
    };
    const v = validateLiveTradeProgramDraft({ ...base, name: "ystock" }, ctx);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toBe(ko.app.liveTradeProgramNameDuplicate);
    }
  });

  it("allows same name when editing that program", () => {
    const ctx = {
      existingPrograms: [{ id: "p1", name: "YSTOCK" }],
      editingProgramId: "p1",
    };
    expect(validateLiveTradeProgramDraft({ ...base, name: "YSTOCK" }, ctx).ok).toBe(
      true,
    );
  });

  it("hasDuplicateProgramName is case-insensitive", () => {
    expect(
      hasDuplicateProgramName("ystock", [{ id: "a", name: "YSTOCK" }]),
    ).toBe(true);
  });
});
