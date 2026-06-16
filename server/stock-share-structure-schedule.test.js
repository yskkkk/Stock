import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isShareStructureRunWindow,
  shareStructureCloseMinutes,
  shouldRunShareStructureScan,
} from "./stock-share-structure-schedule.js";

describe("shareStructureCloseMinutes", () => {
  it("KR 15:30 · US 16:00", () => {
    assert.equal(shareStructureCloseMinutes("kr"), 15 * 60 + 30);
    assert.equal(shareStructureCloseMinutes("us"), 16 * 60);
  });
});

describe("isShareStructureRunWindow", () => {
  it("KR — 마감 직후 윈도우", () => {
    const ok = new Date("2026-06-16T06:35:00.000Z"); // 15:35 KST
    const early = new Date("2026-06-16T05:00:00.000Z"); // 14:00 KST
    assert.equal(isShareStructureRunWindow("kr", ok), true);
    assert.equal(isShareStructureRunWindow("kr", early), false);
  });

  it("US — 마감 직후 윈도우 (EDT)", () => {
    const ok = new Date("2026-06-16T20:05:00.000Z"); // 16:05 ET (summer)
    const early = new Date("2026-06-16T18:00:00.000Z"); // 14:00 ET
    assert.equal(isShareStructureRunWindow("us", ok), true);
    assert.equal(isShareStructureRunWindow("us", early), false);
  });
});

describe("shouldRunShareStructureScan", () => {
  it("같은 세션키면 스킵", () => {
    const now = new Date("2026-06-16T06:35:00.000Z");
    assert.equal(
      shouldRunShareStructureScan("kr", "kr:2026-06-16", now),
      false,
    );
  });

  it("윈도우 안·세션 다르면 실행", () => {
    const now = new Date("2026-06-16T06:35:00.000Z");
    assert.equal(shouldRunShareStructureScan("kr", "kr:2026-06-15", now), true);
  });
});
