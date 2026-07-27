import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildProportionalBuyPlan,
  isRebalanceRegularSession,
} from "./toss-rebalance-schedule.js";

describe("buildProportionalBuyPlan", () => {
  it("splits KRW cash by holding weights", () => {
    const plan = buildProportionalBuyPlan(
      {
        cash: { krw: 100_000, usd: 0 },
        holdings: [
          {
            symbol: "A",
            name: "A",
            market: "kr",
            quantity: 1,
            marketValue: 75_000,
          },
          {
            symbol: "B",
            name: "B",
            market: "kr",
            quantity: 1,
            marketValue: 25_000,
          },
        ],
      },
      "kr",
      100,
    );
    expect(plan.cashToSpend).toBe(100_000);
    expect(plan.orders).toHaveLength(2);
    expect(plan.orders[0].symbol).toBe("A");
    expect(plan.orders[0].amount).toBe(75_000);
    expect(plan.orders[1].amount).toBe(25_000);
  });

  it("uses USD cash for US holdings only", () => {
    const plan = buildProportionalBuyPlan(
      {
        cash: { krw: 1_000_000, usd: 200 },
        holdings: [
          {
            symbol: "GOOGL",
            name: "Alphabet",
            market: "us",
            quantity: 1,
            marketValue: 100,
          },
          {
            symbol: "005930",
            name: "Samsung",
            market: "kr",
            quantity: 1,
            marketValue: 50_000,
          },
        ],
      },
      "us",
      50,
    );
    expect(plan.cashToSpend).toBe(100);
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0].symbol).toBe("GOOGL");
    expect(plan.orders[0].amount).toBe(100);
  });
});

describe("isRebalanceRegularSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("false in US after-hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T23:30:00.000Z")); // 19:30 ET Tue
    expect(isRebalanceRegularSession("us")).toBe(false);
  });

  it("true in US regular session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T14:00:00.000Z")); // 10:00 ET Tue
    expect(isRebalanceRegularSession("us")).toBe(true);
  });

  it("false in KR after close", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T07:00:00.000Z")); // 16:00 KST Tue
    expect(isRebalanceRegularSession("kr")).toBe(false);
  });
});
