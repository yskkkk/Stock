import { test } from "vitest";
import assert from "node:assert/strict";
import {
  formatScanEmailChangePercent,
  formatScanEmailHitLine,
  formatScanEmailPrice,
  resolveScanEmailDisplayName,
} from "./golden-cross-scan-email-enrich.js";

test("formatScanEmailPrice formats KRW and USD", () => {
  assert.equal(formatScanEmailPrice(72500, "KRW", "kr"), "72,500원");
  assert.equal(formatScanEmailPrice(123.456, "USD", "us"), "$123.46");
});

test("formatScanEmailChangePercent adds sign", () => {
  assert.equal(formatScanEmailChangePercent(1.25), "+1.25%");
  assert.equal(formatScanEmailChangePercent(-2.1), "-2.10%");
});

test("resolveScanEmailDisplayName prefers Korean for US", () => {
  const name = resolveScanEmailDisplayName(
    { symbol: "INTC", name: "Intel Corporation", market: "us" },
    { INTC: { nameKo: "인텔" } },
  );
  assert.equal(name, "인텔");
});

test("formatScanEmailHitLine includes quote and industry", () => {
  const line = formatScanEmailHitLine(
    {
      symbol: "005930.KS",
      name: "Samsung",
      displayName: "삼성전자",
      price: 72000,
      changePercent: 1.2,
      currency: "KRW",
      industry: "반도체",
    },
    "kr",
  );
  assert.match(line, /삼성전자/);
  assert.match(line, /72,000원/);
  assert.match(line, /\+1\.20%/);
  assert.match(line, /반도체/);
});
