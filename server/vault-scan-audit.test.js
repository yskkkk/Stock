import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  auditVaultScanRange,
  findVaultScanGapsForDate,
  isUsTradingDay,
  listTradingDatesInRange,
} from "./vault-scan-audit.js";

const DATA_DIR = path.join(
  process.cwd(),
  "server",
  `.data-vault-audit-test-${Date.now()}`,
);

test("listTradingDatesInRange includes consecutive days", () => {
  const dates = listTradingDatesInRange("2026-07-05", "2026-07-07");
  assert.deepEqual(dates, ["2026-07-05", "2026-07-06", "2026-07-07"]);
});

test("isUsTradingDay rejects weekend", () => {
  assert.equal(isUsTradingDay("2026-07-05"), false);
  assert.equal(isUsTradingDay("2026-07-06"), true);
});

test("findVaultScanGapsForDate reports all components when state empty", () => {
  process.env.STOCK_DATA_DIR = DATA_DIR;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const gaps = findVaultScanGapsForDate("kr", "2026-07-06");
    assert.ok(gaps.length >= 8);
    assert.ok(gaps.some((g) => g.component === "book_accum"));
    assert.ok(gaps.some((g) => g.component === "book_accum_fast"));
  } finally {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    delete process.env.STOCK_DATA_DIR;
  }
});

test("auditVaultScanRange skips KR weekend", () => {
  process.env.STOCK_DATA_DIR = DATA_DIR;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const audit = auditVaultScanRange({
      fromDate: "2026-07-05",
      toDate: "2026-07-05",
      markets: ["kr"],
    });
    assert.equal(audit.gapCount, 0);
  } finally {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    delete process.env.STOCK_DATA_DIR;
  }
});
