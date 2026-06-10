import { describe, expect, it } from "vitest";
import {
  formatGoldenCrossChain,
  formatMaAlignChain,
} from "./stockVaultMaDisplay";

describe("formatGoldenCrossChain", () => {
  it("returns ordered chain for partial crosses", () => {
    expect(formatGoldenCrossChain(["5>120", "5>20"])).toBe("5→20→120");
  });

  it("returns null when empty", () => {
    expect(formatGoldenCrossChain([])).toBeNull();
    expect(formatGoldenCrossChain(undefined)).toBeNull();
  });

  it("returns full chain when all cross", () => {
    expect(formatGoldenCrossChain(["5>20", "5>60", "5>120"])).toBe(
      "5→20→60→120",
    );
  });
});

describe("formatMaAlignChain", () => {
  it("matches detection condition notation", () => {
    expect(formatMaAlignChain()).toBe("5>20>60>120");
  });
});
