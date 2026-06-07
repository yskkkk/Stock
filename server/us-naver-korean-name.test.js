import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveUsKoreanStockName } from "./us-naver-korean-name.js";

test("resolveUsKoreanStockName returns Korean from Naver for NASDAQ ticker", async () => {
  const name = await resolveUsKoreanStockName("POOL");
  assert.ok(name);
  assert.match(name, /[\uAC00-\uD7A3]/);
});
