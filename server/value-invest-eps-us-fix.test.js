import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteMoneyFromStatementRow,
  isPlausibleAnnualEps,
} from "./stock-financials-analysis.js";
import { epsFromNetIncomeAndShares } from "./value-invest-eps-from-statement.js";
import { loadAnnualEpsHistory } from "./value-invest-eps-history.js";

test("absoluteMoneyFromStatementRow — Yahoo US full dollar string", () => {
  const n = absoluteMoneyFromStatementRow(
    "112,010,000,000",
    "단위: USD (millions)",
  );
  assert.equal(n, 112_010_000_000);
});

test("absoluteMoneyFromStatementRow — KR 억원", () => {
  const n = absoluteMoneyFromStatementRow("547,300", "단위: 억원");
  assert.equal(n, 547_300 * 1e8);
});

test("absoluteMoneyFromStatementRow — B suffix", () => {
  assert.equal(
    absoluteMoneyFromStatementRow("96.99B", "단위: USD"),
    96.99e9,
  );
});

test("absoluteMoneyFromStatementRow — small millions table", () => {
  assert.equal(
    absoluteMoneyFromStatementRow("96.99", "단위: USD (millions)"),
    96.99e6,
  );
});

test("epsFromNetIncomeAndShares — US AAPL-scale", () => {
  const detail = {
    sections: [
      {
        unitNote: "단위: USD (millions)",
        rows: [{ label: "당기순이익", value: "112,010,000,000" }],
      },
    ],
  };
  const eps = epsFromNetIncomeAndShares(detail, 14_687_356_000);
  assert.ok(eps != null && eps > 6 && eps < 9);
});

test("isPlausibleAnnualEps rejects million-scale mistakes", () => {
  assert.equal(isPlausibleAnnualEps(7.6, "us"), true);
  assert.equal(isPlausibleAnnualEps(6_795_164, "us"), false);
});

test("loadAnnualEpsHistory — US symbols in plausible range", async () => {
  const hist = await loadAnnualEpsHistory("AAPL");
  assert.ok(hist.length >= 3);
  for (const row of hist) {
    assert.ok(
      isPlausibleAnnualEps(row.eps, "us"),
      `AAPL ${row.year} eps=${row.eps}`,
    );
  }
});
