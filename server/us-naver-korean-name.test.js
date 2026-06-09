import { test } from "vitest";
import assert from "node:assert/strict";
import {
  resolveUsKoreanStockName,
  resolveUsStockDisplayMeta,
  usTickerToTradingViewSymbol,
  yahooExchangeCodeToTradingViewPrefix,
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
  assert.equal(usTickerToTradingViewSymbol("WAB", "NYQ"), "NYSE:WAB");
});

test("yahooExchangeCodeToTradingViewPrefix maps Yahoo codes", () => {
  assert.equal(yahooExchangeCodeToTradingViewPrefix("NYQ"), "NYSE");
  assert.equal(yahooExchangeCodeToTradingViewPrefix("NMS"), "NASDAQ");
});

test("resolveUsStockDisplayMeta maps NYSE WAB to TradingView NYSE symbol", async () => {
  const meta = await resolveUsStockDisplayMeta("WAB");
  assert.equal(meta.tvSymbol, "NYSE:WAB");
});
