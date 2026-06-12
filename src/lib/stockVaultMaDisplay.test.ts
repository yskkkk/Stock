import { describe, expect, it } from "vitest";
import { resolveMa120Approach } from "./stockVaultMaDisplay";

describe("resolveMa120Approach", () => {
  it("uses stored approach when not flat", () => {
    expect(resolveMa120Approach({ ma120Approach: "from_below" })).toBe("from_below");
  });

  it("ignores stored flat and falls back to ma120Side", () => {
    expect(
      resolveMa120Approach({ ma120Approach: "flat", ma120Side: "above" }),
    ).toBe("from_above");
  });

  it("derives from current price vs ma120", () => {
    expect(
      resolveMa120Approach({ ma120Approach: "flat", ma120: 100 }, null, 97),
    ).toBe("from_below");
    expect(
      resolveMa120Approach({ ma120Approach: "flat", ma120: 100 }, null, 103),
    ).toBe("from_above");
  });

  it("uses chart insight side when within proximity", () => {
    expect(
      resolveMa120Approach(
        { ma120: 100 },
        { daily: { near: [{ period: 120, side: "below", approach: "flat" }] } },
      ),
    ).toBe("from_below");
  });
});
