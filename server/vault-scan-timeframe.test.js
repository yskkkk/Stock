import { describe, expect, it } from "vitest";
import {
  normalizeVaultScanTimeframe,
  vaultScanStateDateField,
} from "./vault-scan-timeframe.js";

describe("vault-scan-timeframe", () => {
  it("normalizes weekly aliases", () => {
    expect(normalizeVaultScanTimeframe("1wk")).toBe("1wk");
    expect(normalizeVaultScanTimeframe("weekly")).toBe("1wk");
    expect(normalizeVaultScanTimeframe(undefined)).toBe("1d");
  });

  it("maps state fields", () => {
    expect(vaultScanStateDateField("kr", "1wk")).toBe("krWeeklyLastScanDate");
    expect(vaultScanStateDateField("us", "1d")).toBe("usLastScanDate");
  });
});
