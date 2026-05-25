import { describe, expect, it } from "vitest";
import { buildAdminLiveTradingRunningPayload } from "./access-admin-live-trading.js";

describe("access-admin-live-trading", () => {
  it("buildAdminLiveTradingRunningPayload returns programs array", () => {
    const data = buildAdminLiveTradingRunningPayload();
    expect(Array.isArray(data.programs)).toBe(true);
    expect(typeof data.armedCount).toBe("number");
    expect(typeof data.simCount).toBe("number");
    expect(typeof data.fetchedAtMs).toBe("number");
  });
});
