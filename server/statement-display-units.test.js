import { test } from "vitest";
import assert from "node:assert/strict";
import {
  formatKrEokDisplay,
  normalizeKrStatementMoneyValue,
} from "./statement-display-units.js";

test("normalizeKrStatementMoneyValue converts won raw to eok scale", () => {
  const note = "단위: 억원";
  assert.equal(
    normalizeKrStatementMoneyValue("1,041,895,730,000", note, "매출액"),
    "10,419",
  );
  assert.equal(normalizeKrStatementMoneyValue("10,419", note, "매출액"), "10,419");
  assert.equal(formatKrEokDisplay(10418.9573), "10,419");
});
