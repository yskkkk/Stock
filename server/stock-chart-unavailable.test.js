import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  chartNotFoundError,
  isStockChartUnavailableError,
  isSymbolNotFound,
  stockChartUnavailableReason,
  SYMBOL_NOT_FOUND,
} from "./errors.js";
import { finishVaultScanSymbolOnLoadError } from "./vault-scan-symbol-error.js";

describe("stock chart unavailable errors", () => {
  it("detects SYMBOL_NOT_FOUND code", () => {
    const err = chartNotFoundError("496320.KS", "No data found, symbol may be delisted");
    assert.equal(isSymbolNotFound(err), true);
    assert.equal(isStockChartUnavailableError(err), true);
    assert.equal(stockChartUnavailableReason(err), "delisted");
  });

  it("detects wrapped loadStock message", () => {
    const err = new Error(
      "종목 데이터를 가져올 수 없습니다: 496320.KS (No data found, symbol may be delisted)",
    );
    assert.equal(isStockChartUnavailableError(err), true);
  });

  it("finishVaultScanSymbolOnLoadError treats delisted as ok skip", () => {
    const err = chartNotFoundError("008110.KS", "delisted");
    const r = finishVaultScanSymbolOnLoadError("book-accum", "008110.KS", "1d", err);
    assert.equal(r.ok, true);
    assert.equal(r.hit, null);
  });

  it("finishVaultScanSymbolOnLoadError keeps real failures as ok:false", () => {
    const err = new Error("Yahoo session");
    const r = finishVaultScanSymbolOnLoadError("book-accum", "005930.KS", "1d", err);
    assert.equal(r.ok, false);
    assert.equal(SYMBOL_NOT_FOUND, "SYMBOL_NOT_FOUND");
  });
});
