import { test } from "vitest";
import assert from "node:assert/strict";
import {
  resolveUsKoreanStockName,
  resolveUsStockDisplayMeta,
  usTickerToTradingViewSymbol,
} from "./us-naver-korean-name.js";

test("resolveUsKoreanStockName returns Korean from Naver for NASDAQ ticker", async () => {
  const name = await resolveUsKoreanStockName("POOL");
  assert.ok(name);
  assert.match(name, /[\uAC00-\uD7A3]/);
});

test("resolveUsStockDisplayMeta maps NYSE TJX to TradingView NYSE symbol", async () => {
  const meta = await resolveUsStockDisplayMeta("TJX");
  assert.equal(meta.tvSymbol, "NYSE:TJX");
  assert.ok(meta.nameKo);
});

test("usTickerToTradingViewSymbol uses exchange prefix", () => {
  assert.equal(usTickerToTradingViewSymbol("TJX", "NYSE"), "NYSE:TJX");
  assert.equal(usTickerToTradingViewSymbol("POOL", "NASDAQ"), "NASDAQ:POOL");
});
