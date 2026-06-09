import assert from "node:assert/strict";
import test from "node:test";
import { parseTossOpenOrdersResult } from "./toss-openapi.js";
import { validateTossAccountId, validateTossCredentialSet } from "./stock-input-validation.js";

const SAMPLE_KEY = "client-id-0123456789abcdef012345";
const SAMPLE_SECRET = "client-secret-fedcba9876543210fedcba";

test("validateTossAccountId accepts accountSeq 1", () => {
  const out = validateTossAccountId("1");
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.value, "1");
});

test("parseTossOpenOrdersResult reads result.orders from paginated envelope", () => {
  const rows = parseTossOpenOrdersResult({
    orders: [{ orderId: "a1", symbol: "005930" }],
    nextCursor: null,
    hasNext: false,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderId, "a1");
});

test("validateTossCredentialSet allows empty accountSeq on first save", () => {
  const out = validateTossCredentialSet(SAMPLE_KEY, SAMPLE_SECRET, "", {
    configured: false,
  });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.value.accountId, "");
  }
});
