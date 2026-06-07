import { test } from "vitest";
import assert from "node:assert/strict";
import {
  goldenCrossDaysSince,
  goldenCrossRecencyTier,
  sortGoldenCrossItems,
} from "./goldenCrossRecency";

test("goldenCrossRecencyTier buckets", () => {
  assert.equal(goldenCrossRecencyTier(0), "recent-3");
  assert.equal(goldenCrossRecencyTier(3), "recent-3");
  assert.equal(goldenCrossRecencyTier(4), "recent-6");
  assert.equal(goldenCrossRecencyTier(6), "recent-6");
  assert.equal(goldenCrossRecencyTier(7), "recent-10");
  assert.equal(goldenCrossRecencyTier(10), "recent-10");
  assert.equal(goldenCrossRecencyTier(11), null);
});

test("sortGoldenCrossItems orders by crossDate desc", () => {
  const sorted = sortGoldenCrossItems([
    { crossDate: "2026-06-01", updatedAtMs: 1 },
    { crossDate: "2026-06-08", updatedAtMs: 2 },
    { crossDate: "2026-06-05", updatedAtMs: 3 },
  ]);
  assert.deepEqual(
    sorted.map((x) => x.crossDate),
    ["2026-06-08", "2026-06-05", "2026-06-01"],
  );
});

test("goldenCrossDaysSince uses KST calendar days", () => {
  const now = new Date("2026-06-08T15:00:00+09:00");
  assert.equal(goldenCrossDaysSince("2026-06-08", now), 0);
  assert.equal(goldenCrossDaysSince("2026-06-05", now), 3);
});
