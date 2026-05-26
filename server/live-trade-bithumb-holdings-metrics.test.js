import { describe, expect, it } from "vitest";
import {
  applyProgramLedgerToBithumbHoldingMetrics,
  bithumbKrwTotalFromAccounts,
} from "./live-trade-bithumb-holdings.js";

describe("applyProgramLedgerToBithumbHoldingMetrics", () => {
  it("caps quantity to ledger", () => {
    const m = applyProgramLedgerToBithumbHoldingMetrics(
      2,
      100,
      { quantity: 1, costBasis: 90 },
    );
    expect(m.quantity).toBe(1);
    expect(m.costBasis).toBe(90);
  });

  it("uses exchange when no ledger", () => {
    const m = applyProgramLedgerToBithumbHoldingMetrics(1.5, 200, null);
    expect(m.quantity).toBe(1.5);
    expect(m.costBasis).toBe(300);
  });
});

describe("bithumbKrwTotalFromAccounts", () => {
  it("sums KRW balance and locked", () => {
    const total = bithumbKrwTotalFromAccounts([
      { currency: "KRW", balance: "12000", locked: "3000" },
      { currency: "BTC", balance: "0.01", locked: "0" },
    ]);
    expect(total).toBe(15000);
  });
});
