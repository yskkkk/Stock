import { describe, expect, it } from "vitest";
import { buildLastScanRows, formatLastScanDateCell } from "./stockVaultLastScan";
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
        lastRuns: [],
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
});
