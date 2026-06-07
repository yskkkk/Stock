import { test } from "vitest";
import assert from "node:assert/strict";
import {
  isKnownLightLogoSymbol,
  normalizeStockLogoSymbol,
} from "./stockLogoContrast";

test("normalizeStockLogoSymbol strips market suffixes", () => {
  assert.equal(normalizeStockLogoSymbol("INTC"), "INTC");
  assert.equal(normalizeStockLogoSymbol("005930.KS"), "005930");
});

test("isKnownLightLogoSymbol detects Intel", () => {
  assert.equal(isKnownLightLogoSymbol("INTC", "us"), true);
  assert.equal(isKnownLightLogoSymbol("AAPL", "us"), false);
});
