import { describe, expect, it } from "vitest";
import {
  formatLimitPriceSeed,
  limitPriceDeviationPct,
  parseLimitPriceInput,
} from "./tossOrderLimitPrice";

describe("tossOrderLimitPrice", () => {
  it("parseLimitPriceInput accepts 0 and decimals", () => {
    expect(parseLimitPriceInput("0")).toBe(0);
    expect(parseLimitPriceInput("25.6")).toBe(25.6);
    expect(parseLimitPriceInput("")).toBeNull();
    expect(parseLimitPriceInput("-1")).toBeNull();
  });

  it("limitPriceDeviationPct", () => {
    expect(limitPriceDeviationPct(25.6, 57.85)).toBeCloseTo(55.75, 1);
    expect(limitPriceDeviationPct(57, 57.85)).toBeCloseTo(1.47, 1);
  });

  it("formatLimitPriceSeed keeps zero", () => {
    expect(formatLimitPriceSeed(0, "us")).toBe("0");
  });
});
