import { describe, expect, it } from "vitest";
import {
  hasStockCryptoMarketConflict,
  normalizeExclusiveProgramMarkets,
  toggleProgramMarketDraft,
} from "./liveTradeProgramMarkets";

describe("liveTradeProgramMarkets", () => {
  it("clears stocks when enabling crypto", () => {
    const next = toggleProgramMarketDraft(
      { marketsKr: true, marketsUs: false, marketsCrypto: false },
      "marketsCrypto",
    );
    expect(next).toEqual({
      marketsKr: false,
      marketsUs: false,
      marketsCrypto: true,
    });
  });

  it("clears crypto when enabling kr", () => {
    const next = toggleProgramMarketDraft(
      { marketsKr: false, marketsUs: false, marketsCrypto: true },
      "marketsKr",
    );
    expect(next?.marketsCrypto).toBe(false);
    expect(next?.marketsKr).toBe(true);
  });

  it("allows kr and us together", () => {
    const next = toggleProgramMarketDraft(
      { marketsKr: true, marketsUs: false, marketsCrypto: false },
      "marketsUs",
    );
    expect(next).toEqual({
      marketsKr: true,
      marketsUs: true,
      marketsCrypto: false,
    });
  });

  it("detects stock+crypto conflict", () => {
    expect(
      hasStockCryptoMarketConflict({ kr: true, us: false, crypto: true }),
    ).toBe(true);
    expect(
      hasStockCryptoMarketConflict({ kr: false, us: true, crypto: true }),
    ).toBe(true);
    expect(
      hasStockCryptoMarketConflict({ kr: true, us: true, crypto: false }),
    ).toBe(false);
  });

  it("normalize keeps crypto only when overlapping", () => {
    expect(
      normalizeExclusiveProgramMarkets({ kr: true, us: true, crypto: true }),
    ).toEqual({ kr: false, us: false, crypto: true });
  });
});
