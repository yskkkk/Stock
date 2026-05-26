import { describe, expect, it, vi, afterEach } from "vitest";
import {
  isMarketOpenBySchedule,
  isStockTradableBySchedule,
} from "./market-hours.js";

describe("market-hours", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KR regular session only inside 09:00–15:30", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T00:30:00.000Z")); // 09:30 KST Tue
    expect(isMarketOpenBySchedule("kr")).toBe(true);
    vi.setSystemTime(new Date("2026-05-26T06:29:00.000Z")); // 15:29 KST
    expect(isMarketOpenBySchedule("kr")).toBe(true);
    vi.setSystemTime(new Date("2026-05-26T06:31:00.000Z")); // 15:31 KST
    expect(isMarketOpenBySchedule("kr")).toBe(false);
  });

  it("KR tradable includes pre/after extended hours on business day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T23:30:00.000Z")); // 08:30 KST Mon
    expect(isStockTradableBySchedule("kr")).toBe(true);
    vi.setSystemTime(new Date("2026-05-25T23:00:00.000Z")); // 08:00 KST
    expect(isStockTradableBySchedule("kr")).toBe(false);
    vi.setSystemTime(new Date("2026-05-26T06:00:00.000Z")); // 15:00 KST
    expect(isStockTradableBySchedule("kr")).toBe(true);
    vi.setSystemTime(new Date("2026-05-26T08:29:00.000Z")); // 17:29 KST
    expect(isStockTradableBySchedule("kr")).toBe(true);
    vi.setSystemTime(new Date("2026-05-26T09:00:00.000Z")); // 18:00 KST
    expect(isStockTradableBySchedule("kr")).toBe(false);
  });

  it("KR tradable false on public holiday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:30:00.000Z")); // 09:30 KST 신정
    expect(isStockTradableBySchedule("kr")).toBe(false);
  });

  it("US tradable includes pre/after on weekday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T08:30:00.000Z")); // 04:30 ET Tue
    expect(isStockTradableBySchedule("us")).toBe(true);
    expect(isMarketOpenBySchedule("us")).toBe(false);
    vi.setSystemTime(new Date("2026-05-26T13:30:00.000Z")); // 09:30 ET
    expect(isMarketOpenBySchedule("us")).toBe(true);
    vi.setSystemTime(new Date("2026-05-26T23:30:00.000Z")); // 19:30 ET
    expect(isStockTradableBySchedule("us")).toBe(true);
    expect(isMarketOpenBySchedule("us")).toBe(false);
    vi.setSystemTime(new Date("2026-05-27T00:30:00.000Z")); // 20:30 ET
    expect(isStockTradableBySchedule("us")).toBe(false);
  });
});
