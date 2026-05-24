import { describe, expect, it } from "vitest";
import {
  applyCryptoPriceDisplay,
  cryptoQuoteForKrwDisplay,
} from "./cryptoDisplayQuote";

describe("cryptoQuoteForKrwDisplay", () => {
  it("converts USDT price with USD/KRW rate", () => {
    const out = cryptoQuoteForKrwDisplay(
      {
        symbol: "ZTX-USDT",
        name: "ZTX",
        price: 0.92,
        changePercent: 13.69,
        currency: "USDT",
      },
      1350,
    );
    expect(out?.currency).toBe("KRW");
    expect(out?.price).toBe(1242);
  });

  it("keeps KRW quotes unchanged", () => {
    const q = {
      symbol: "BTC-USDT",
      name: "BTC",
      price: 114_660_000,
      currency: "KRW",
    };
    expect(cryptoQuoteForKrwDisplay(q, 1350)).toEqual(q);
  });

  it("converts KRW back to USDT for display", () => {
    const out = applyCryptoPriceDisplay(
      {
        symbol: "BTC-USDT",
        name: "BTC",
        price: 135_000_000,
        currency: "KRW",
      },
      "usdt",
      1350,
    );
    expect(out?.currency).toBe("USDT");
    expect(out?.price).toBeCloseTo(100_000, 0);
  });
});
