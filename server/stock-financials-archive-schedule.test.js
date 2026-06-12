import assert from "node:assert/strict";
import test from "node:test";
import {
  financialsArchiveTargetMinutes,
  isFinancialsArchiveRunWindow,
  isFinancialsArchiveTradingDay,
  shouldRunFinancialsArchive,
} from "./stock-financials-archive-schedule.js";

test("KR archive window starts 08:50 KST (10m before regular open)", () => {
  const before = new Date("2026-06-09T23:49:00.000Z"); // 2026-06-10 08:49 KST
  const at = new Date("2026-06-09T23:50:00.000Z"); // 2026-06-10 08:50 KST
  assert.equal(isFinancialsArchiveRunWindow("kr", before), false);
  assert.equal(isFinancialsArchiveRunWindow("kr", at), true);
  assert.equal(financialsArchiveTargetMinutes("kr"), 8 * 60 + 50);
});

test("US archive window starts 09:20 ET (10m before regular open)", () => {
  const before = new Date("2026-06-10T13:19:00.000Z"); // 09:19 ET (EDT)
  const at = new Date("2026-06-10T13:20:00.000Z"); // 09:20 ET
  assert.equal(isFinancialsArchiveRunWindow("us", before), false);
  assert.equal(isFinancialsArchiveRunWindow("us", at), true);
  assert.equal(financialsArchiveTargetMinutes("us"), 9 * 60 + 20);
});

test("shouldRunFinancialsArchive runs once per session", () => {
  const now = new Date("2026-06-09T23:55:00.000Z"); // 2026-06-10 08:55 KST
  assert.equal(isFinancialsArchiveTradingDay("kr", now), true);
  assert.equal(shouldRunFinancialsArchive("kr", null, now), true);
  assert.equal(shouldRunFinancialsArchive("kr", "kr:2026-06-10", now), false);
});
