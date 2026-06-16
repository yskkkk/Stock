import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseYahooShareStructure,
  sumInsiderHolderShares,
  deriveOtherNonFloatFromTotal,
} from "./stock-share-structure-yahoo.js";

describe("sumInsiderHolderShares", () => {
  it("sums direct and indirect positions", () => {
    const total = sumInsiderHolderShares([
      { positionDirect: { raw: 1000 }, positionIndirect: { raw: 500 } },
      { positionDirect: { raw: 200 } },
    ]);
    assert.equal(total, 1700);
  });
});

describe("deriveOtherNonFloatFromTotal", () => {
  it("returns positive gap between total, float, insider", () => {
    assert.equal(deriveOtherNonFloatFromTotal(1000, 900, 50), 50);
    assert.equal(deriveOtherNonFloatFromTotal(1000, 950, 100), null);
  });
});

describe("parseYahooShareStructure", () => {
  it("parses WELL-like payload with institutional pct over 100%", () => {
    const out = parseYahooShareStructure({
      defaultKeyStatistics: {
        sharesOutstanding: { raw: 705_914_450 },
        floatShares: { raw: 704_947_347 },
        heldPercentInsiders: { raw: 0.00062 },
        heldPercentInstitutions: { raw: 1.02622 },
        sharesShort: { raw: 17_755_855 },
        shortPercentOfFloat: { raw: 0.0286 },
      },
      majorHoldersBreakdown: {
        institutionsPercentHeld: { raw: 1.02622 },
        institutionsFloatPercentHeld: { raw: 1.02686 },
        institutionsCount: { raw: 2072 },
      },
      insiderHolders: { holders: [] },
    });
    assert.ok(out);
    assert.equal(out.totalShares, 705_914_450);
    assert.equal(out.floatShares, 704_947_347);
    assert.ok(out.majorShareholderShares != null && out.majorShareholderShares > 400_000);
    assert.equal(out.institutionalShares, null);
    assert.ok(out.institutionalTotalPct != null && out.institutionalTotalPct > 100);
    assert.ok(out.institutionalFloatPct != null && out.institutionalFloatPct > 100);
    assert.equal(out.sharesShort, 17_755_855);
    assert.ok(out.shortPctOfFloat != null && Math.abs(out.shortPctOfFloat - 2.86) < 0.01);
    assert.equal(out.institutionCount, 2072);
    assert.ok(out.otherNonFloatShares != null && out.otherNonFloatShares > 400_000);
  });

  it("estimates institutional shares when float pct is at most 100%", () => {
    const out = parseYahooShareStructure({
      defaultKeyStatistics: {
        sharesOutstanding: { raw: 1_000_000 },
        floatShares: { raw: 800_000 },
        heldPercentInsiders: { raw: 0.05 },
      },
      majorHoldersBreakdown: {
        institutionsFloatPercentHeld: { raw: 0.6 },
        institutionsCount: { raw: 120 },
      },
    });
    assert.ok(out);
    assert.equal(out.institutionalShares, 480_000);
    assert.equal(out.institutionCount, 120);
  });
});
