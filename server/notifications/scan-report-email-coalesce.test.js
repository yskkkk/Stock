import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./golden-cross-scan-email.js", () => ({
  sendGoldenCrossScanReportEmailNow: vi.fn(async () => ({
    sent: 1,
    goldenCrossHits: 1,
    maAlignHits: 0,
    ma120NearHits: 0,
    bookAccumHits: 0,
    lowSlopeFlipHits: 0,
    bottomCandleHits: 0,
    totalHits: 1,
  })),
}));

import { sendGoldenCrossScanReportEmailNow } from "./golden-cross-scan-email.js";
import {
  flushScanReportEmailNow,
  queueScanReportEmail,
} from "./scan-report-email-coalesce.js";

describe("scan-report-email-coalesce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(sendGoldenCrossScanReportEmailNow).mockClear();
  });

  afterEach(async () => {
    await flushScanReportEmailNow();
    vi.useRealTimers();
  });

  it("merges vault and bottom payloads into one send", async () => {
    await queueScanReportEmail({
      goldenCross: [{ market: "kr", scanDate: "2026-06-21", timeframe: "1d", scanned: 300, hits: [] }],
    });
    await queueScanReportEmail({
      bottomCandle: [{ market: "kr", scanDate: "2026-06-21", timeframe: "1d", scanned: 300, hits: [] }],
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(sendGoldenCrossScanReportEmailNow).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(sendGoldenCrossScanReportEmailNow).mock.calls[0][0];
    expect(payload.goldenCross).toHaveLength(1);
    expect(payload.bottomCandle).toHaveLength(1);
  });

  it("flushScanReportEmailNow sends immediately", async () => {
    await queueScanReportEmail({
      maAlign: [{ market: "us", scanDate: "2026-06-21", timeframe: "1d", scanned: 500, hits: [] }],
    });
    await flushScanReportEmailNow();
    expect(sendGoldenCrossScanReportEmailNow).toHaveBeenCalledTimes(1);
  });
});
