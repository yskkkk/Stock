import { describe, expect, it } from "vitest";
import {
  formatGoldenCrossChain,
  formatMaAlignChain,
} from "./stockVaultMaDisplay";

describe("formatGoldenCrossChain", () => {
  it("formats Pine-aligned crosses", () => {
    expect(formatGoldenCrossChain(["20>120", "5>20"])).toBe(
      "5→20 골든 · 20→120 골든",
    );
    expect(formatGoldenCrossChain(["5<20", "20<120"])).toBe(
      "5→20 데드 · 20→120 데드",
    );
  });

  it("returns null when empty", () => {
    expect(formatGoldenCrossChain([])).toBeNull();
    expect(formatGoldenCrossChain(undefined)).toBeNull();
  });

  it("keeps legacy 5>60/5>120 labels", () => {
    expect(formatGoldenCrossChain(["5>20", "5>60", "5>120"])).toBe(
      "5→20 골든 · 5→60 골든 · 5→120 골든",
    );
  });
});

describe("formatMaAlignChain", () => {
  it("matches detection condition notation", () => {
    expect(formatMaAlignChain()).toBe("5>20>60>120");
  });
});
