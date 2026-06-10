import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  appendGoldenCrossHistoryEntrySync,
  listGoldenCrossHistoryDatesSync,
  listGoldenCrossHistoryRunsSync,
} from "./golden-cross-history-store.js";
import {
  clearGoldenCrossVaultItemsSync,
  listStockVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
  upsertStockVaultItemSync,
} from "./stock-vault-store.js";
import { buildGoldenCrossScanEmailContent } from "./notifications/golden-cross-scan-email.js";
import { setUserVaultFavoriteSync } from "./user-stock-vault-store.js";

beforeEach(() => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.STOCK_VAULT_STORE_TEST_FILE = `stock-vault-test-${id}.json`;
  process.env.USER_STOCK_VAULT_STORE_TEST_FILE = `user-stock-vault-test-${id}.json`;
  process.env.GOLDEN_CROSS_HISTORY_TEST_FILE = `golden-cross-history-test-${id}.json`;
});

test("golden cross history groups runs by runId", () => {
  const runId = "run-test-1";
  appendGoldenCrossHistoryEntrySync({
    runId,
    trigger: "manual",
    market: "kr",
    scanDate: "2026-06-08",
    scanned: 300,
    hits: [
      {
        symbol: "005930.KS",
        name: "삼성전자",
        market: "kr",
        crosses: ["5>20"],
        scanDate: "2026-06-08",
      },
    ],
  });
  appendGoldenCrossHistoryEntrySync({
    runId,
    trigger: "manual",
    market: "us",
    scanDate: "2026-06-07",
    scanned: 500,
    hits: [],
  });
  const runs = listGoldenCrossHistoryRunsSync();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, runId);
  assert.equal(runs[0].markets.length, 2);
  assert.ok(listGoldenCrossHistoryDatesSync().includes("2026-06-08"));
});

test("clearGoldenCrossVaultItemsSync keeps favorited auto items", () => {
  const userId = `user-${Date.now()}`;
  const fav = `GCFAV${Date.now()}.KS`;
  const plain = `GCPLN${Date.now()}.KS`;
  upsertStockVaultItemSync({
    symbol: fav,
    name: "즐겨찾기골든",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>20"],
    scanDate: "2026-06-08",
  });
  upsertStockVaultItemSync({
    symbol: plain,
    name: "일반골든",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>60"],
    scanDate: "2026-06-08",
  });
  setUserVaultFavoriteSync(userId, fav, true);
  assert.equal(clearGoldenCrossVaultItemsSync(), 1);
  const symbols = listStockVaultItemsSync().map((it) => it.symbol);
  assert.ok(symbols.includes(fav));
  assert.ok(!symbols.includes(plain));
});

test("buildGoldenCrossScanEmailContent includes hits with quote columns", () => {
  const { subject, text, html, goldenCrossHits, maAlignHits } = buildGoldenCrossScanEmailContent({
    goldenCross: [
      {
        market: "kr",
        scanDate: "2026-06-08",
        scanned: 300,
        hits: [
          {
            symbol: "005930.KS",
            name: "삼성전자",
            displayName: "삼성전자",
            crosses: ["5>20"],
            price: 72000,
            changePercent: 1.2,
            currency: "KRW",
            industry: "반도체",
          },
        ],
      },
    ],
    maAlign: [
      {
        market: "us",
        scanDate: "2026-06-08",
        scanned: 500,
        hits: [
          {
            symbol: "INTC",
            name: "Intel Corporation",
            displayName: "인텔",
            price: 21.5,
            changePercent: -0.8,
            currency: "USD",
            industry: "반도체",
          },
        ],
      },
    ],
  });
  assert.match(subject, /일봉·주봉 탐색 리포트/);
  assert.match(text, /일봉/);
  assert.match(html, /주봉/);
  assert.equal(goldenCrossHits, 1);
  assert.equal(maAlignHits, 1);
  assert.match(text, /삼성전자/);
  assert.match(text, /72,000원/);
  assert.match(text, /인텔/);
  assert.match(html, /업종/);
  assert.match(html, /인텔/);
});
