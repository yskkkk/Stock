import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCatalogBoxesForTimeframe,
  isProCatalogTimeframe,
} from "./catalog-detect.js";
import { BOX_RANGE_CATALOG_DIR_PRO } from "./constants.js";
import { resolveCatalogRootDir } from "./catalog-store.js";

test("isProCatalogTimeframe", () => {
  assert.equal(isProCatalogTimeframe("4h"), true);
  assert.equal(isProCatalogTimeframe("1d"), true);
  assert.equal(isProCatalogTimeframe("1h"), false);
});

test("detectCatalogBoxesForTimeframe skips 1h", () => {
  const bars = [];
  for (let i = 0; i < 30; i++) {
    bars.push({
      time: 1_700_000_000 + i * 3600,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100,
    });
  }
  assert.deepEqual(detectCatalogBoxesForTimeframe(bars, "1h"), []);
});

test("resolveCatalogRootDir defaults to PRO catalog", () => {
  const prev = process.env.STOCK_BOX_RANGE_CATALOG_DIR;
  delete process.env.STOCK_BOX_RANGE_CATALOG_DIR;
  try {
    assert.equal(resolveCatalogRootDir(), BOX_RANGE_CATALOG_DIR_PRO);
  } finally {
    if (prev !== undefined) process.env.STOCK_BOX_RANGE_CATALOG_DIR = prev;
    else delete process.env.STOCK_BOX_RANGE_CATALOG_DIR;
  }
});
