import { describe, expect, it } from "vitest";
import { formatMacroCountdown, macroCardNearness } from "./formatMacro";

describe("formatMacroCountdown", () => {
  it("uses D-n for multi-day remaining", () => {
    const ms = (1 * 86400 + 18 * 3600 + 16 * 60 + 3) * 1000;
    expect(formatMacroCountdown(ms)).toBe("D-1 18:16:03");
  });

  it("uses D-day within the same day", () => {
    expect(formatMacroCountdown(5 * 3600 * 1000)).toBe("D-day 05:00:00");
  });

  it("uses D-day when live or past", () => {
    expect(formatMacroCountdown(0)).toBe("D-day");
    expect(formatMacroCountdown(-1000)).toBe("D-day");
  });
});

describe("macroCardNearness", () => {
  it("is strongest when due now", () => {
    expect(macroCardNearness(0)).toBe(1);
  });

  it("is zero beyond 10 days", () => {
    expect(macroCardNearness(11 * 86400_000)).toBe(0);
  });
});
