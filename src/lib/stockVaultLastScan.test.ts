import { describe, expect, it } from "vitest";
import {
  buildLastScanRows,
  formatLastScanDateCell,
  formatLastScanHmKst,
} from "./stockVaultLastScan";
import type { StockVaultScanStatus } from "../types";

function baseStatus(): StockVaultScanStatus {
  return {
    enabled: true,
    running: false,
    lastManualScan: null,
    goldenCross: {
      state: {
        krLastScanDate: "2026-06-15",
        usLastScanDate: "2026-06-14",
        krWeeklyLastScanDate: "2026-06-15",
        usWeeklyLastScanDate: "2026-06-14",
        lastRuns: [
          {
            market: "kr",
            scanDate: "2026-06-15",
            timeframe: "1d",
            scanned: 300,
            hits: 5,
            atMs: Date.parse("2026-06-15T05:30:00.000Z"),
          },
          {
            market: "us",
            scanDate: "2026-06-14",
            timeframe: "1d",
            scanned: 500,
            hits: 3,
            atMs: Date.parse("2026-06-14T22:15:00.000Z"),
          },
        ],
      },
    },
    maAlign: {
      state: {
        krLastScanDate: "2026-06-15",
        usLastScanDate: "2026-06-14",
        krWeeklyLastScanDate: "2026-06-15",
        usWeeklyLastScanDate: "2026-06-14",
        lastRuns: [],
      },
    },
    state: {
      krLastScanDate: "2026-06-15",
      usLastScanDate: "2026-06-14",
      lastRuns: [],
    },
  };
}

describe("stockVaultLastScan", () => {
  it("builds rows for each scan source", () => {
    const rows = buildLastScanRows(baseStatus());
    expect(rows).toHaveLength(2);
    expect(rows?.[0]?.key).toBe("golden_cross");
    expect(rows?.[1]?.key).toBe("ma_align");
    expect(rows?.[0]?.dailyKr).toBe("2026-06-15");
  });

  it("includes bottom candle row when present", () => {
    const status = baseStatus();
    status.bottomCandle = {
      enabled: true,
      running: false,
      lastManualScan: null,
      state: {
        krLastScanDate: "2026-06-14",
        usLastScanDate: "2026-06-13",
        krWeeklyLastScanDate: "2026-06-14",
        usWeeklyLastScanDate: "2026-06-13",
        lastRuns: [],
      },
    };
    const rows = buildLastScanRows(status);
    expect(rows?.some((r) => r.key === "bottom_candle")).toBe(true);
  });

  it("formats date as MM-DD", () => {
    expect(formatLastScanDateCell("2026-06-15")).toEqual({
      label: "06-15",
      title: "2026-06-15",
      empty: false,
    });
    expect(formatLastScanDateCell(null).empty).toBe(true);
  });

  it("includes KST hour and minute when atMs is provided", () => {
    const atMs = Date.parse("2026-06-15T05:30:00.000Z");
    expect(formatLastScanHmKst(atMs)).toBe("14:30");
    expect(formatLastScanDateCell("2026-06-15", atMs)).toEqual({
      label: "06-15 14:30",
      title: "2026-06-15 14:30",
      empty: false,
    });
  });

  it("resolves last scan atMs from lastRuns per market and timeframe", () => {
    const rows = buildLastScanRows(baseStatus());
    const gc = rows?.find((r) => r.key === "golden_cross");
    expect(gc?.dailyKrAtMs).toBe(Date.parse("2026-06-15T05:30:00.000Z"));
    expect(gc?.dailyUsAtMs).toBe(Date.parse("2026-06-14T22:15:00.000Z"));
    expect(gc?.weeklyKrAtMs).toBeNull();
  });
});
