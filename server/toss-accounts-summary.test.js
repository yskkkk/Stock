import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTossAccountsForDisplay } from "./toss-accounts-summary.js";

test("summarizeTossAccountsForDisplay maps holdings and cash", () => {
  const snap = summarizeTossAccountsForDisplay({
    buyingPowerKrw: { cashBuyingPower: "1000000" },
    buyingPowerUsd: { cashBuyingPower: "100.5" },
    holdings: {
      profitLoss: { amount: { krw: "50000", usd: "10" } },
      marketValue: { amount: { krw: "2000000", usd: "500" } },
      items: [
        {
          symbol: "005930",
          name: "삼성전자",
          marketCountry: "KR",
          currency: "KRW",
          quantity: "10",
          lastPrice: "72000",
          averagePurchasePrice: "65000",
          marketValue: { amount: "720000" },
          profitLoss: { rate: "0.1077" },
          dailyProfitLoss: { rate: "0.01" },
        },
      ],
    },
  });

  assert.equal(snap.cash.krw, 1_000_000);
  assert.equal(snap.cash.usd, 100.5);
  assert.equal(snap.holdings.length, 1);
  assert.equal(snap.holdings[0]?.symbol, "005930.KS");
  assert.equal(snap.holdings[0]?.market, "kr");
  assert.ok(Math.abs((snap.holdings[0]?.returnPercent ?? 0) - 10.77) < 0.01);
});
