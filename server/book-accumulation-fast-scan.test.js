import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const loadStock = vi.fn();

vi.mock("./stock-data.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadStock: (...args) => loadStock(...args),
    runStockDataScanSession: (_opts, fn) => fn(),
  };
});

vi.mock("./yahoo-queue.js", () => ({
  runWithYahooScanTune: (_tune, fn) => fn(),
}));

vi.mock("./golden-cross-tradable.js", () => ({
  isGoldenCrossTradable: async () => ({ ok: true }),
}));

vi.mock("./book-accumulation-detect.js", () => ({
  detectBookAccumulationLatest: (candles) =>
    candles.length >= 3
      ? { anyAccum: true, score: 70, rvol: 2, signalDate: "2026-06-20" }
      : { anyAccum: false },
}));

beforeEach(() => {
  loadStock.mockReset();
});

test("scanOneSymbolBookAccumFast fetches 1d once for both timeframes", async () => {
  const daily = {
    candles: [{ close: 1 }, { close: 2 }, { close: 3 }],
    quote: { name: "Test" },
  };
  const weekly = {
    candles: [{ close: 1 }, { close: 2 }, { close: 3 }],
    quote: { name: "Test" },
  };
  loadStock.mockImplementation(async (sym, tf) => {
    if (tf === "1d") return daily;
    if (tf === "1wk") return weekly;
    throw new Error(`unexpected tf ${tf}`);
  });

  const { scanOneSymbolBookAccumFast } = await import(
    "./book-accumulation-fast-scan.js"
  );
  const result = await scanOneSymbolBookAccumFast(
    { symbol: "AAPL", name: "Apple" },
    "us",
    "2026-06-20",
    new Set(["1d", "1wk"]),
  );

  assert.equal(result.ok, true);
  assert.equal(result.hits.length, 2);
  assert.equal(loadStock.mock.calls.length, 2);
  assert.equal(loadStock.mock.calls[0][1], "1d");
  assert.equal(loadStock.mock.calls[1][1], "1wk");
});

test("scanOneSymbolBookAccumFast 1d only skips weekly fetch", async () => {
  loadStock.mockResolvedValue({
    candles: [{ close: 1 }, { close: 2 }, { close: 3 }],
    quote: {},
  });

  const { scanOneSymbolBookAccumFast } = await import(
    "./book-accumulation-fast-scan.js"
  );
  await scanOneSymbolBookAccumFast(
    { symbol: "MSFT" },
    "us",
    "2026-06-20",
    new Set(["1d"]),
  );

  assert.equal(loadStock.mock.calls.length, 1);
  assert.equal(loadStock.mock.calls[0][1], "1d");
});
