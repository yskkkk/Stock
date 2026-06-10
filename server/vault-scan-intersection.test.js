import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildEmailTimeframeIntersections,
  intersectHitsBySymbol,
} from "./vault-scan-intersection.js";

test("intersectHitsBySymbol keeps daily and weekly pairs", () => {
  const pairs = intersectHitsBySymbol(
    [{ symbol: "A.KS", name: "A" }, { symbol: "B.KS", name: "B" }],
    [{ symbol: "A.KS", name: "A" }, { symbol: "C.KS", name: "C" }],
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].daily.symbol, "A.KS");
  assert.equal(pairs[0].weekly.symbol, "A.KS");
});

test("buildEmailTimeframeIntersections groups by market", () => {
  const rows = buildEmailTimeframeIntersections(
    [
      {
        market: "kr",
        scanDate: "2026-06-10",
        timeframe: "1d",
        hits: [{ symbol: "005930.KS", name: "삼성", crosses: ["5>20"] }],
      },
      {
        market: "kr",
        scanDate: "2026-06-10",
        timeframe: "1wk",
        hits: [{ symbol: "005930.KS", name: "삼성", crosses: ["5>60"] }],
      },
    ],
    [
      {
        market: "kr",
        scanDate: "2026-06-10",
        timeframe: "1d",
        hits: [{ symbol: "000660.KS", name: "SK" }],
      },
      {
        market: "kr",
        scanDate: "2026-06-10",
        timeframe: "1wk",
        hits: [],
      },
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].goldenCross.length, 1);
  assert.equal(rows[0].maAlign.length, 0);
});
