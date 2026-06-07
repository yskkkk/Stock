import { describe, expect, it } from "vitest";
import {
  favoriteChangePercent,
  favoriteDPlusDays,
  formatFavoriteDPlus,
} from "./favoriteTracking";

describe("favoriteTracking", () => {
  it("favoriteDPlusDays same KST day is 0", () => {
    const ms = new Date("2026-06-08T10:00:00+09:00").getTime();
    expect(favoriteDPlusDays(ms, ms)).toBe(0);
  });

  it("favoriteDPlusDays counts KST calendar days", () => {
    const start = new Date("2026-06-08T23:00:00+09:00").getTime();
    const next = new Date("2026-06-09T01:00:00+09:00").getTime();
    expect(favoriteDPlusDays(start, next)).toBe(1);
  });

  it("favoriteChangePercent", () => {
    expect(favoriteChangePercent(110, 100)).toBeCloseTo(10);
    expect(favoriteChangePercent(90, 100)).toBeCloseTo(-10);
    expect(favoriteChangePercent(null, 100)).toBeNull();
  });

  it("formatFavoriteDPlus", () => {
    expect(formatFavoriteDPlus(3)).toBe("D+3");
    expect(formatFavoriteDPlus(null)).toBe("—");
  });
});
