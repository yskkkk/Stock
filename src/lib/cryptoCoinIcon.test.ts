import { describe, expect, it } from "vitest";
import { cryptoCoinIconUrl, cryptoIconSlug } from "./cryptoCoinIcon";

describe("cryptoIconSlug", () => {
  it("parses USDT pairs for crypto market only", () => {
    expect(cryptoIconSlug("BTC-USDT", "crypto")).toBe("btc");
    expect(cryptoIconSlug("BTC-USDT", "kr")).toBeNull();
    expect(cryptoIconSlug("005930.KS", "kr")).toBeNull();
  });
});

describe("cryptoCoinIconUrl", () => {
  it("builds jsdelivr icon path", () => {
    expect(cryptoCoinIconUrl("btc")).toContain("/btc.png");
  });
});
