import { describe, expect, it } from "vitest";
import {
  countProgramMarketsSelected,
  normalizeSingleProgramMarkets,
  selectProgramMarketDraft,
} from "./liveTradeProgramMarkets";

describe("liveTradeProgramMarkets", () => {
  it("selects exactly one market", () => {
    expect(
      selectProgramMarketDraft(
        { marketsKr: true, marketsUs: false, marketsCrypto: false },
        "marketsUs",
      ),
    ).toEqual({
      marketsKr: false,
      marketsUs: true,
      marketsCrypto: false,
    });
  });

  it("selects crypto only", () => {
    expect(
      selectProgramMarketDraft(
        { marketsKr: true, marketsUs: false, marketsCrypto: false },
        "marketsCrypto",
      ),
    ).toEqual({
      marketsKr: false,
      marketsUs: false,
      marketsCrypto: true,
    });
  });

  it("normalize keeps one market (crypto > kr > us)", () => {
    expect(
      normalizeSingleProgramMarkets({ kr: true, us: true, crypto: true }),
    ).toEqual({ kr: false, us: false, crypto: true });
    expect(
      normalizeSingleProgramMarkets({ kr: true, us: true, crypto: false }),
    ).toEqual({ kr: true, us: false, crypto: false });
    expect(
      normalizeSingleProgramMarkets({ kr: false, us: false, crypto: false }),
    ).toEqual({ kr: true, us: false, crypto: false });
  });

  it("counts selected markets", () => {
    expect(
      countProgramMarketsSelected({ kr: true, us: true, crypto: false }),
    ).toBe(2);
  });
});
