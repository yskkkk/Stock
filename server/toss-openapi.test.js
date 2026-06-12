import assert from "node:assert/strict";
import test from "node:test";
import { isTossInvalidTokenError } from "./toss-api-queue.js";
import { formatTossOpenApiError, parseTossOpenOrdersResult } from "./toss-openapi.js";
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

test("isTossInvalidTokenError matches Korean Toss auth failures", () => {
  assert.equal(isTossInvalidTokenError(new Error("유효하지 않은 토큰입니다")), true);
  assert.equal(isTossInvalidTokenError(new Error("요청 한도를 초과했습니다")), false);
});

test("formatTossOpenApiError includes errorCode when present", () => {
  const msg = formatTossOpenApiError(
    { error: { reason: "토큰이 유효하지 않습니다.", errorCode: "CE1000" } },
    401,
  );
  assert.match(msg, /CE1000/);
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
