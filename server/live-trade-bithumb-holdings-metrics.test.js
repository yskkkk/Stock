import { describe, expect, it } from "vitest";
import { applyProgramLedgerToBithumbHoldingMetrics } from "./live-trade-bithumb-holdings.js";

describe("applyProgramLedgerToBithumbHoldingMetrics", () => {
  it("uses ledger qty and cost when exchange balance is larger", () => {
    const m = applyProgramLedgerToBithumbHoldingMetrics(
      10,
      5000,
      { quantity: 2, costBasis: 18000 },
    );
    expect(m.quantity).toBe(2);
    expect(m.costBasis).toBe(18000);
    expect(m.avgEntry).toBe(9000);
  });

  it("scales cost when exchange qty is below ledger", () => {
    const m = applyProgramLedgerToBithumbHoldingMetrics(
      1,
      5000,
      { quantity: 2, costBasis: 20000 },
    );
    expect(m.quantity).toBe(1);
    expect(m.costBasis).toBe(10000);
  });
});
