import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHeldNewsSymbol, resolveHeldSymbolCollectFlags } from "./holdings-news-symbols.js";

test("normalizeHeldNewsSymbol adds .KS to 6-digit KR code", () => {
  assert.equal(normalizeHeldNewsSymbol("005930"), "005930.KS");
  assert.equal(normalizeHeldNewsSymbol("AAPL"), "AAPL");
});

test("accountStocksOnly keeps toss and drops vault/sim/crypto sources", () => {
  const flags = resolveHeldSymbolCollectFlags({ accountStocksOnly: true });
  assert.equal(flags.includeToss, true);
  assert.equal(flags.includeVault, false);
  assert.equal(flags.includePortfolio, false);
  assert.equal(flags.includeBithumb, false);
});

