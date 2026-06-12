import assert from "node:assert/strict";
import test from "node:test";
import { epsFromNetIncomeAndShares } from "./value-invest-eps-from-statement.js";

test("KR 당기순이익(억원) ÷ 발행주식 → EPS 원/주", () => {
  const detail = {
    sections: [
      {
        unitNote: "단위: 억원",
        rows: [{ label: "당기순이익", value: "547,300" }],
      },
    ],
  };
  const eps = epsFromNetIncomeAndShares(detail, 5_764_191_903);
  assert.ok(eps != null && eps > 9000 && eps < 10000);
});
