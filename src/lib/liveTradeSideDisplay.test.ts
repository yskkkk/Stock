import { describe, expect, it } from "vitest";
import { formatTradeSideLabel } from "./liveTradeSideDisplay";

describe("formatTradeSideLabel", () => {
  it("formats program and exchange sources", () => {
    expect(
      formatTradeSideLabel({ side: "buy", simulated: false, exchangeImport: false }),
    ).toBe("매수 (프로그램)");
    expect(
      formatTradeSideLabel({ side: "sell", simulated: false, exchangeImport: true }),
    ).toBe("매도 (거래소)");
    expect(
      formatTradeSideLabel({ side: "sell", simulated: true, exchangeImport: false }),
    ).toBe("매도 (시뮬)");
  });
});
