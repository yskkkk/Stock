import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNaverPureBuyQuant,
  parseTrendChangePercent,
  parseTrendTradingValue,
} from "./kr-investor-flow.js";

test("parseNaverPureBuyQuant parses signed comma quantities", () => {
  assert.equal(parseNaverPureBuyQuant("-3,840,270"), -3840270);
  assert.equal(parseNaverPureBuyQuant("+6,424,717"), 6424717);
  assert.equal(parseNaverPureBuyQuant("0"), 0);
  assert.equal(parseNaverPureBuyQuant(""), null);
});

test("parseTrendChangePercent derives signed percent from trend row", () => {
  assert.equal(
    Number(
      parseTrendChangePercent({
        closePrice: "104,500",
        compareToPreviousClosePrice: "4,700",
      })?.toFixed(2),
    ),
    4.71,
  );
  assert.equal(
    Number(
      parseTrendChangePercent({
        closePrice: "222,500",
        compareToPreviousClosePrice: "-7,000",
      })?.toFixed(2),
    ),
    -3.05,
  );
});

test("parseTrendTradingValue multiplies close by volume", () => {
  assert.equal(
    parseTrendTradingValue("104,500", "4,535,581"),
    104500 * 4535581,
  );
  assert.equal(parseTrendTradingValue("104,500", ""), null);
});
