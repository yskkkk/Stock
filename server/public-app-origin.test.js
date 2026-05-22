import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  isIpHost,
  normalizeHttpsOrigin,
  validateIosOtaHttpsOrigin,
} from "./public-app-origin.js";

describe("public-app-origin", () => {
  it("detects ipv4", () => {
    expect(isIpHost("182.219.226.49")).toBe(true);
    expect(isIpHost("stock.example.com")).toBe(false);
  });

  it("normalizes https origin", () => {
    expect(normalizeHttpsOrigin("https://stock.example.com/")).toBe(
      "https://stock.example.com",
    );
    expect(normalizeHttpsOrigin("http://x.com")).toBe(null);
  });

  it("rejects ip for ota by default", () => {
    const prev = process.env.STOCK_IOS_OTA_ALLOW_IP;
    delete process.env.STOCK_IOS_OTA_ALLOW_IP;
    expect(
      validateIosOtaHttpsOrigin("https://182.219.226.49").ok,
    ).toBe(false);
    if (prev) process.env.STOCK_IOS_OTA_ALLOW_IP = prev;
  });
});
