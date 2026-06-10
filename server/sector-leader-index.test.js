import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSectorLeaderIndex,
  evaluateSectorLeaderForIndustry,
} from "./sector-leader-index.js";

test("evaluateSectorLeaderForIndustry — leader across kr+us by usd market cap", () => {
  const evaluated = evaluateSectorLeaderForIndustry([
    {
      symbol: "005930.KS",
      market: "kr",
      industry: "반도체",
      marketCapUsd: 400_000,
      roe: 0.12,
      profitMargin: 0.18,
    },
    {
      symbol: "NVDA",
      market: "us",
      industry: "반도체",
      marketCapUsd: 3_000_000,
      roe: 0.7,
      profitMargin: 0.55,
      revenueGrowth: 0.9,
    },
    {
      symbol: "INTC",
      market: "us",
      industry: "반도체",
      marketCapUsd: 180_000,
      roe: 0.02,
      profitMargin: 0.01,
    },
  ]);

  assert.equal(evaluated.leaderSymbol, "NVDA");
  assert.equal(evaluated.bySymbol.NVDA.sectorLeader, true);
  assert.equal(evaluated.bySymbol["005930.KS"].sectorLeader, false);
  assert.ok(evaluated.bySymbol.NVDA.sectorLeaderCriteria.includes("market_cap_rank"));
  assert.ok(evaluated.bySymbol.NVDA.sectorLeaderCriteria.includes("cap_gap"));
});

test("buildSectorLeaderIndex — groups by industry", () => {
  const index = buildSectorLeaderIndex([
    {
      symbol: "AAA",
      market: "us",
      industry: "은행",
      marketCapUsd: 100,
      roe: 0.1,
      profitMargin: 0.2,
    },
    {
      symbol: "BBB",
      market: "kr",
      industry: "은행",
      marketCapUsd: 50,
      roe: 0.08,
      profitMargin: 0.15,
    },
    {
      symbol: "CCC",
      market: "kr",
      industry: "은행",
      marketCapUsd: 30,
      roe: 0.05,
      profitMargin: 0.1,
    },
  ]);
  assert.equal(index.bySymbol.AAA.sectorLeader, true);
  assert.equal(index.bySymbol.BBB.sectorLeader, false);
});
