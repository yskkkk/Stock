import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const gcScan = vi.fn();
const maScan = vi.fn();
const ma120Scan = vi.fn();
const lowSlopeScan = vi.fn();
const bookAccumScan = vi.fn();

vi.mock("./golden-cross-scan.js", () => ({
  runGoldenCrossMarketScan: (...args) => gcScan(...args),
  wasGoldenCrossScannedSync: () => false,
}));

vi.mock("./ma-align-scan.js", () => ({
  runMaAlignMarketScan: (...args) => maScan(...args),
  wasMaAlignScannedSync: () => false,
}));

vi.mock("./ma120-near-scan.js", () => ({
  runMa120NearMarketScan: (...args) => ma120Scan(...args),
  wasMa120NearScannedSync: () => false,
}));

vi.mock("./candle-low-slope-scan.js", () => ({
  runCandleLowSlopeMarketScan: (...args) => lowSlopeScan(...args),
  wasCandleLowSlopeScannedSync: () => false,
}));

vi.mock("./book-accumulation-scan.js", () => ({
  runBookAccumulationMarketScan: (...args) => bookAccumScan(...args),
  wasBookAccumulationScannedSync: () => false,
}));

vi.mock("./golden-cross-telegram.js", () => ({
  notifyGoldenCrossScanTelegram: vi.fn(async () => ({ sent: false })),
  notifyVaultScanStartTelegram: vi.fn(async () => ({ sent: false })),
  notifyVaultScanDoneTelegram: vi.fn(async () => ({ sent: false })),
  notifyVaultTimeframeIntersectionTelegram: vi.fn(async () => ({ sent: false })),
}));

vi.mock("./golden-cross-history-store.js", () => ({
  appendGoldenCrossHistoryEntrySync: vi.fn(),
}));

vi.mock("./ma-align-history-store.js", () => ({
  appendMaAlignHistoryEntrySync: vi.fn(),
}));

vi.mock("./ma120-near-history-store.js", () => ({
  appendMa120NearHistoryEntrySync: vi.fn(),
}));

import {
  listStockVaultItemsSync,
  upsertStockVaultItemSync,
} from "./stock-vault-store.js";
import { runVaultMarketScans } from "./golden-cross-poller.js";

const emptyMarketResult = (market, scanDate) => ({
  market,
  scanDate,
  scanned: 0,
  hits: [],
  hitCount: 0,
});

beforeEach(() => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.STOCK_VAULT_STORE_TEST_FILE = `stock-vault-test-${id}.json`;
  gcScan.mockReset();
  maScan.mockReset();
  ma120Scan.mockReset();
  lowSlopeScan.mockReset();
  bookAccumScan.mockReset();
  ma120Scan.mockImplementation(async (market, scanDate) =>
    emptyMarketResult(market, scanDate),
  );
  lowSlopeScan.mockImplementation(async (market, scanDate) =>
    emptyMarketResult(market, scanDate),
  );
  bookAccumScan.mockImplementation(async (market, scanDate) =>
    emptyMarketResult(market, scanDate),
  );
});

test("runVaultMarketScans runs golden cross and ma align in parallel", async () => {
  let gcStarted = false;
  let maStarted = false;
  gcScan.mockImplementation(async () => {
    gcStarted = true;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(maStarted, true, "ma align should start before gc finishes");
    return {
      market: "kr",
      scanDate: "2026-06-08",
      scanned: 10,
      hits: [],
      hitCount: 0,
    };
  });
  maScan.mockImplementation(async () => {
    maStarted = true;
    return {
      market: "kr",
      scanDate: "2026-06-08",
      scanned: 10,
      hits: [{ symbol: "005930.KS", name: "삼성전자", market: "kr", scanDate: "2026-06-08" }],
      hitCount: 1,
    };
  });

  const result = await runVaultMarketScans("kr", "2026-06-08", "run-1", "manual");

  assert.equal(result.maAlign.hitCount, 1);
  assert.equal(
    listStockVaultItemsSync().filter((it) => it.source === "ma_align").length,
    1,
  );
  assert.equal(result.timings?.length, 8);
});

test("runVaultMarketScans still merges ma align when golden cross fails", async () => {
  upsertStockVaultItemSync({
    symbol: "OLDGC.KS",
    name: "기존골든",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>20"],
    scanDate: "2026-06-07",
  });
  gcScan.mockRejectedValue(new Error("gc down"));
  maScan.mockResolvedValue({
    market: "kr",
    scanDate: "2026-06-08",
    scanned: 10,
    hits: [{ symbol: "000660.KS", name: "SK하이닉스", market: "kr", scanDate: "2026-06-08" }],
    hitCount: 1,
  });

  const result = await runVaultMarketScans("kr", "2026-06-08", "run-2", "manual");

  assert.equal(result.goldenCross.hitCount, 0);
  assert.equal(result.maAlign.hitCount, 1);
  assert.equal(
    listStockVaultItemsSync().filter((it) => it.source === "ma_align").length,
    1,
  );
  assert.ok(
    listStockVaultItemsSync().some(
      (it) => it.source === "golden_cross" && it.symbol === "OLDGC.KS",
    ),
    "golden cross vault preserved when scan fails",
  );
});

test("runVaultMarketScans keeps both golden cross and ma align hits", async () => {
  gcScan.mockResolvedValue({
    market: "kr",
    scanDate: "2026-06-08",
    scanned: 1,
    hits: [
      {
        symbol: "005930.KS",
        name: "삼성전자",
        market: "kr",
        crosses: ["5>20"],
        crossDate: "2026-06-08",
        scanDate: "2026-06-08",
      },
    ],
    hitCount: 1,
  });
  maScan.mockResolvedValue({
    market: "kr",
    scanDate: "2026-06-08",
    scanned: 1,
    hits: [{ symbol: "005930.KS", name: "삼성전자", market: "kr", scanDate: "2026-06-08" }],
    hitCount: 1,
  });

  await runVaultMarketScans("kr", "2026-06-08", "run-both", "manual");

  const items = listStockVaultItemsSync();
  assert.equal(items.filter((it) => it.source === "golden_cross").length, 1);
  assert.equal(items.filter((it) => it.source === "ma_align").length, 1);
});

test("runVaultMarketScans clears only the target market before merge", async () => {
  upsertStockVaultItemSync({
    symbol: "KRGC.KS",
    name: "국내골든",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>20"],
    scanDate: "2026-06-07",
  });
  upsertStockVaultItemSync({
    symbol: "USGC",
    name: "미국골든",
    market: "us",
    source: "golden_cross",
    crosses: ["5>20"],
    scanDate: "2026-06-07",
  });
  upsertStockVaultItemSync({
    symbol: "KRMA.KS",
    name: "국내정배열",
    market: "kr",
    source: "ma_align",
    scanDate: "2026-06-07",
  });

  gcScan.mockResolvedValue({
    market: "kr",
    scanDate: "2026-06-08",
    scanned: 1,
    hits: [{ symbol: "NEWGC.KS", name: "신규골든", market: "kr", crosses: ["5>20"], crossDate: "2026-06-08", scanDate: "2026-06-08" }],
    hitCount: 1,
  });
  maScan.mockResolvedValue({
    market: "kr",
    scanDate: "2026-06-08",
    scanned: 1,
    hits: [{ symbol: "NEWMA.KS", name: "신규정배열", market: "kr", scanDate: "2026-06-08" }],
    hitCount: 1,
  });

  await runVaultMarketScans("kr", "2026-06-08", "run-3", "manual");

  const items = listStockVaultItemsSync();
  const symbols = new Set(items.map((it) => it.symbol));
  assert.ok(symbols.has("NEWGC.KS"));
  assert.ok(symbols.has("NEWMA.KS"));
  assert.ok(symbols.has("USGC"));
  assert.equal(symbols.has("KRGC.KS"), false);
  assert.equal(symbols.has("KRMA.KS"), false);
});
