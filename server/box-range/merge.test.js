import { test } from "vitest";
import assert from "node:assert/strict";
import { findMergeBoxIndex } from "./merge.js";

test("findMergeBoxIndex never merges across 1h / 4h / 1d", () => {
  const existing = [
    {
      top: 100,
      bottom: 90,
      leftTime: 1_000,
      rightTime: 2_000,
      timeframe: "1h",
      state: "idle",
    },
  ];
  const candidate = {
    top: 100,
    bottom: 90,
    leftTime: 1_000,
    rightTime: 2_000,
    timeframe: "1d",
  };
  assert.equal(findMergeBoxIndex(candidate, existing, 86400), -1);
  assert.equal(
    findMergeBoxIndex({ ...candidate, timeframe: "4h" }, existing, 14_400),
    -1,
  );
});

test("findMergeBoxIndex skips in_position boxes", () => {
  const existing = [
    {
      top: 100,
      bottom: 90,
      leftTime: 1_000,
      rightTime: 5_000,
      timeframe: "1h",
      state: "in_position",
    },
  ];
  const candidate = {
    top: 99,
    bottom: 91,
    leftTime: 2_000,
    rightTime: 4_000,
    timeframe: "1h",
  };
  assert.equal(findMergeBoxIndex(candidate, existing, 3600), -1);
});

test("findMergeBoxIndex merges only same timeframe when overlap", () => {
  const existing = [
    {
      top: 100,
      bottom: 90,
      leftTime: 1_000,
      rightTime: 5_000,
      timeframe: "4h",
      state: "idle",
    },
  ];
  const candidate = {
    top: 99,
    bottom: 91,
    leftTime: 2_000,
    rightTime: 4_000,
    timeframe: "4h",
  };
  assert.equal(findMergeBoxIndex(candidate, existing, 14_400), 0);
});
