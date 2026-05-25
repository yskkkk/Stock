import test from "node:test";
import assert from "node:assert/strict";
import {
  BOX_RANGE_QUOTE_MAX_STALE_MS,
  isBoxRangeQuoteFresh,
} from "./quotes.js";

test("isBoxRangeQuoteFresh rejects stale quotedAtMs", () => {
  const old = Date.now() - BOX_RANGE_QUOTE_MAX_STALE_MS - 1_000;
  assert.equal(
    isBoxRangeQuoteFresh({ price: 100, quotedAtMs: old, priceSource: "bithumb-ticker" }),
    false,
  );
  assert.equal(
    isBoxRangeQuoteFresh({ price: 100, quotedAtMs: Date.now(), priceSource: "bithumb-ticker" }),
    true,
  );
});
