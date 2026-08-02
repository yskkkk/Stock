import { describe, expect, it } from "vitest";
import {
  formatMacroCountdown,
  formatMacroWhen,
  macroCardNearness,
} from "./formatMacro";

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

describe("formatMacroWhen", () => {
  it("always formats in Asia/Seoul even if US timezone is passed", () => {
    // 2026-08-03 10:00 America/New_York (EDT, UTC-4) = 2026-08-03 23:00 KST
    const at = Date.parse("2026-08-03T14:00:00.000Z");
    const text = formatMacroWhen(at, "America/New_York");
    expect(text).toMatch(/23:00/);
    expect(text).toMatch(/8\.\s*3/);
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
