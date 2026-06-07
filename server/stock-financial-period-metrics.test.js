import { test } from "vitest";
import assert from "node:assert/strict";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";

test("extractPeriodMetricsFromDetail reads PER EPS from statement rows", () => {
  const metrics = extractPeriodMetricsFromDetail(
    {
      periodId: "n:q:202503",
      label: "2025.03",
      kind: "quarter",
      sections: [
        {
          title: "재무제표",
          unitNote: "단위: 억원",
          rows: [
            { label: "PER", value: "22.18" },
            { label: "EPS", value: "11521" },
            { label: "BPS", value: "196985" },
            { label: "PBR", value: "1.30" },
            { label: "ROE", value: "12.5%" },
          ],
        },
      ],
    },
    { currency: "KRW", market: "kr" },
  );
  assert.equal(metrics.per, 22.18);
  assert.equal(metrics.eps, 11521);
  assert.equal(metrics.pbr, 1.3);
  assert.ok(Math.abs((metrics.roe ?? 0) - 0.125) < 0.001);
});
