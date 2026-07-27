import { describe, expect, it } from "vitest";
import {
  accountSymbolSliceLabel,
  buildAccountAllocationSlices,
  tossHoldingsToAccountRows,
} from "./accountAllocation";

describe("accountAllocation symbol labels", () => {
  it("uses mapped Korean name in symbol mode legend", () => {
    const rows = tossHoldingsToAccountRows(
      [
        {
          symbol: "000120.KS",
          name: "000120.KS",
          market: "kr",
          currency: "KRW",
          quantity: 10,
          avgBuyPrice: 1000,
          returnPercent: 5,
        },
      ],
      null,
      null,
      new Map(),
    );
    expect(rows[0]?.name).toBe("CJ대한통운");
    const slices = buildAccountAllocationSlices(rows, 0, "symbol", {
      cash: "현금",
      other: "기타",
      marketKr: "국내",
      marketUs: "해외",
      marketCrypto: "코인",
    });
    expect(slices[0]?.label).toBe("000120 · CJ대한통운");
  });

  it("formats US mapped Korean names with ticker", () => {
    const label = accountSymbolSliceLabel(
      { symbol: "VRSK", name: "Verisk Analytics, Inc.", market: "us" },
      "기타",
    );
    expect(label).toBe("VRSK · 베리스크");
  });
});
