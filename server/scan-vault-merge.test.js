import { describe, expect, it } from "vitest";
import { assessScanVaultMerge } from "./scan-vault-merge.js";

describe("assessScanVaultMerge", () => {
  it("empty universe preserves vault", () => {
    const a = assessScanVaultMerge({ scanned: 0, hitCount: 0, errors: 0 });
    expect(a.outcome).toBe("failed_empty_universe");
    expect(a.shouldClear).toBe(false);
    expect(a.shouldMerge).toBe(false);
  });

  it("high error ratio preserves vault", () => {
    const a = assessScanVaultMerge({ scanned: 100, hitCount: 0, errors: 50 });
    expect(a.outcome).toBe("failed_high_errors");
    expect(a.shouldClear).toBe(false);
  });

  it("clean zero clears without merge", () => {
    const a = assessScanVaultMerge({ scanned: 500, hitCount: 0, errors: 2 });
    expect(a.outcome).toBe("ok_zero_hits");
    expect(a.shouldClear).toBe(true);
    expect(a.shouldMerge).toBe(false);
  });

  it("hits clear and merge", () => {
    const a = assessScanVaultMerge({ scanned: 500, hitCount: 3, errors: 1 });
    expect(a.outcome).toBe("ok_with_hits");
    expect(a.shouldClear).toBe(true);
    expect(a.shouldMerge).toBe(true);
  });
});
