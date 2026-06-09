import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHeldNewsSymbol } from "./holdings-news-symbols.js";

test("normalizeHeldNewsSymbol adds .KS to 6-digit KR code", () => {
  assert.equal(normalizeHeldNewsSymbol("005930"), "005930.KS");
  assert.equal(normalizeHeldNewsSymbol("AAPL"), "AAPL");
});
