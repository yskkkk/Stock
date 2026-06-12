import { describe, expect, it } from "vitest";
import { selectPeriodIdsForArchive } from "./stock-financials-archive.js";

describe("selectPeriodIdsForArchive", () => {
  it("KR — DART 연간 우선", () => {
    const periods = [
      { id: "n:a:202512", kind: "annual", isForecast: false, endDateMs: 10 },
      { id: "d:a:2024", kind: "annual", isForecast: false, endDateMs: 20 },
      { id: "d:a:2023", kind: "annual", isForecast: false, endDateMs: 15 },
    ];
    const ids = selectPeriodIdsForArchive(periods, "kr");
    expect(ids[0]).toBe("d:a:2024");
    expect(ids.filter((id) => id.startsWith("d:a:")).length).toBeGreaterThan(0);
  });
});
