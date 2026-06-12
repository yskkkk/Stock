import { describe, expect, it } from "vitest";
import {
  collectKstMonths,
  collectKstYears,
  filterTradesByKstPeriod,
  tradeKstYearMonth,
} from "./liveTradeHistoryPeriodFilter";
import type { LiveTradeRecord } from "../api";

function trade(atMs: number): LiveTradeRecord {
  return {
    id: String(atMs),
    atMs,
    side: "buy",
    symbol: "TEST",
    market: "kr",
    currency: "KRW",
    quantity: 1,
    price: 1000,
    amount: 1000,
    programId: "toss-exchange",
  };
}

describe("liveTradeHistoryPeriodFilter", () => {
  it("filters by KST year and month", () => {
    const aug2025 = Date.parse("2025-08-16T00:23:00+09:00");
    const jul2025 = Date.parse("2025-07-12T01:12:00+09:00");
    const rows = [trade(aug2025), trade(jul2025)];
    expect(collectKstYears(rows)).toEqual([2025]);
    expect(collectKstMonths(rows, 2025)).toEqual([7, 8]);
    expect(filterTradesByKstPeriod(rows, 2025, 8)).toHaveLength(1);
    expect(filterTradesByKstPeriod(rows, 2025, 8)[0]?.atMs).toBe(aug2025);
  });

  it("returns all when year and month are null", () => {
    const rows = [trade(Date.now())];
    expect(filterTradesByKstPeriod(rows, null, null)).toHaveLength(1);
  });

  it("parses KST parts", () => {
    const ms = Date.parse("2025-08-16T00:23:00+09:00");
    expect(tradeKstYearMonth(ms)).toEqual({ year: 2025, month: 8 });
  });
});
