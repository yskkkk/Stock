import { describe, expect, it } from "vitest";
import { formatPrice } from "./format";

describe("formatPrice USDT", () => {
  it("shows enough decimals for sub-cent prices", () => {
    expect(formatPrice(0.00074, "USDT")).toBe("0.00074 USDT");
    expect(formatPrice(0.001524, "USDT")).toMatch(/0\.0015\d* USDT/);
  });

  it("keeps two decimals for large USDT prices", () => {
    expect(formatPrice(98432.5, "USDT")).toBe("98,432.5 USDT");
  });

  it("keeps KRW as integer won", () => {
    expect(formatPrice(1, "KRW")).toBe("1원");
  });
});
