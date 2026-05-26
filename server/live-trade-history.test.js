import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildLiveTradeHistoryPayload,
  filterTradesByScenario,
  kstDateKeyFromMs,
  shiftKstDateKey,
} from "./live-trade-history.js";
import { writePortfolioStoreSync } from "./live-trade-portfolio-store.js";
import { writeProgramsStoreSync } from "./live-trade-programs-store.js";

test("filterTradesByScenario splits sim and live", () => {
  const rows = [
    { simulated: true, market: "crypto" },
    { simulated: false, market: "crypto" },
    { simulated: false, market: "kr" },
  ];
  assert.equal(filterTradesByScenario(rows, "sim").length, 1);
  assert.equal(filterTradesByScenario(rows, "live-bithumb").length, 1);
  assert.equal(filterTradesByScenario(rows, "live-toss").length, 1);
});

test("shiftKstDateKey moves calendar days in KST", () => {
  assert.equal(shiftKstDateKey("2026-05-25", -1), "2026-05-24");
  assert.equal(shiftKstDateKey("2026-05-01", -1), "2026-04-30");
});

test("buildLiveTradeHistoryPayload filters by KST day range", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lt-hist-"));
  const prevData = process.env.STOCK_DATA_DIR;
  process.env.STOCK_DATA_DIR = dir;

  try {
    const userId = "user-hist-1";
    const programId = "prog-hist-1";
    writeProgramsStoreSync({
      programs: [
        {
          id: programId,
          userId,
          name: "테스트",
          status: "armed",
          modelId: "m1",
          markets: { kr: false, us: false, crypto: true },
          minScoreRatio: 0.5,
          maxOpenPositions: 3,
          orderAmountKrw: 10000,
          orderAmountUsd: 0,
          updatedAtMs: Date.now(),
        },
      ],
    });

    const dayA = "2026-05-24";
    const dayB = "2026-05-25";
    const msA = new Date(`${dayA}T10:00:00+09:00`).getTime();
    const msB = new Date(`${dayB}T10:00:00+09:00`).getTime();

    writePortfolioStoreSync({
      trades: [
        {
          id: "t-old",
          programId,
          side: "buy",
          symbol: "BTC",
          name: "Bitcoin",
          market: "crypto",
          quantity: 1,
          price: 1,
          amount: 1,
          currency: "KRW",
          feeAmount: 0,
          simulated: false,
          orderId: null,
          note: null,
          atMs: msA,
        },
        {
          id: "t-new",
          programId,
          side: "sell",
          symbol: "BTC",
          name: "Bitcoin",
          market: "crypto",
          quantity: 1,
          price: 2,
          amount: 2,
          currency: "KRW",
          feeAmount: 0,
          simulated: false,
          orderId: null,
          note: null,
          atMs: msB,
        },
      ],
    });

    const oneDay = buildLiveTradeHistoryPayload(userId, {
      endDay: dayB,
      days: 1,
    });
    assert.equal(oneDay.trades.length, 1);
    assert.equal(oneDay.trades[0].id, "t-new");
    assert.equal(oneDay.hasOlder, true);
    assert.equal(oneDay.nextOlderEndDay, dayA);

    const twoDays = buildLiveTradeHistoryPayload(userId, {
      endDay: dayB,
      days: 2,
    });
    assert.equal(twoDays.trades.length, 2);
    assert.equal(twoDays.rangeStartDay, dayA);

    const allTrades = buildLiveTradeHistoryPayload(userId, { all: true });
    assert.equal(allTrades.trades.length, 2);
    assert.equal(allTrades.trades[0].id, "t-new");
    assert.equal(allTrades.trades[1].id, "t-old");
    assert.equal(allTrades.hasOlder, false);
    assert.equal(allTrades.nextOlderEndDay, null);
  } finally {
    if (prevData === undefined) delete process.env.STOCK_DATA_DIR;
    else process.env.STOCK_DATA_DIR = prevData;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
