import {
  listArmedLiveTradeProgramsSync,
  listSimActiveProgramsSync,
} from "../live-trade-programs-store.js";
import { loadStock } from "../stock-data.js";
import { pickQuoteFromMap } from "../quote-symbol-resolve.js";
import {
  fetchBoxRangeLastPrices,
  isBoxRangeQuoteFresh,
} from "./quotes.js";
import { liveTradeLogWarn } from "../live-trade-log.js";
import { collectWatchSymbolsForProgram } from "./watch-symbols.js";
import { BOX_RANGE_TIMEFRAMES, isBoxRangeProgram } from "./constants.js";
import { detectBoxRangesOnCandles } from "./detect.js";
import {
  listBoxesForProgramSync,
  upsertDetectedBoxSync,
} from "./store.js";
import { processBoxFsmForProgram } from "./runner-fsm.js";
import { syncBoxRangeWsSubscriptions } from "./ws-sync.js";
import { reconcileBoxRangeLotsFromPortfolioSync } from "./lot-reconcile.js";
import { syncCatalogTradingBoxesFromCatalogSync } from "./catalog-trading-sync.js";

const TICK_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_TICK_MS ?? 3_000);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 30_000) : 3_000;
})();

/**
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
function normalizeTime(t) {
  if (Number.isFinite(t)) return t;
  if (t && typeof t === "object" && t.year) {
    return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000) - 9 * 3600;
  }
  return null;
}

async function loadCandlesForBoxTf(symbol, timeframe) {
  const data = await loadStock(symbol, timeframe, { live: true });
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  return candles
    .map((c) => {
      if (!c) return null;
      const time = normalizeTime(c.time);
      if (time == null || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
        return null;
      }
      return { ...c, time };
    })
    .filter(Boolean);
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
async function runDetectionForTf(program, symbol, timeframe) {
  const candles = await loadCandlesForBoxTf(symbol, timeframe);
  if (candles.length < 20) return;
  const boxes = detectBoxRangesOnCandles(candles, timeframe);
  const userId = String(program.userId ?? "").trim();
  for (const detected of boxes) {
    upsertDetectedBoxSync({
      programId: program.id,
      userId,
      symbol,
      timeframe,
      top: detected.top,
      bottom: detected.bottom,
      mid: detected.mid,
      leftTime: detected.leftTime,
      rightTime: detected.rightTime,
    });
  }
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
async function tickCryptoProgram(program) {
  const symbols = await collectWatchSymbolsForProgram(program);
  const live = program.status === "armed";
  const sim = program.status === "sim";

  for (const tf of BOX_RANGE_TIMEFRAMES) {
    for (const sym of symbols) {
      try {
        await runDetectionForTf(program, sym, tf);
      } catch (e) {
        liveTradeLogWarn(
          "[box-range:detect]",
          program.name,
          sym,
          tf,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  const quotes = await fetchBoxRangeLastPrices(symbols);
  const boxes = listBoxesForProgramSync(program.id).filter(
    (b) => !b.catalogBoxId && b.tradeEligible !== false,
  );

  for (const box of boxes) {
    const q = pickQuoteFromMap(quotes, box.symbol, "crypto");
    if (!isBoxRangeQuoteFresh(q)) continue;
    const lastPrice = Number(q?.price);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
    if (live || sim) {
      await processBoxFsmForProgram(program, box, lastPrice, live);
    }
  }
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {"us"|"kr"} catalogMarket
 */
async function tickCatalogProgram(program, catalogMarket) {
  syncCatalogTradingBoxesFromCatalogSync(program, catalogMarket);
  const live = program.status === "armed";
  const sim = program.status === "sim";
  if (!live && !sim) return;

  const boxes = listBoxesForProgramSync(program.id).filter(
    (b) =>
      b.catalogBoxId &&
      (b.catalogMarket === catalogMarket ||
        (!b.catalogMarket && catalogMarket === "us")) &&
      b.tradeEligible !== false &&
      b.state !== "closed",
  );
  const symbols = [...new Set(boxes.map((b) => b.symbol))];
  if (!symbols.length) return;

  const quotes = await fetchBoxRangeLastPrices(symbols);
  for (const box of boxes) {
    const q = pickQuoteFromMap(quotes, box.symbol, catalogMarket);
    if (!isBoxRangeQuoteFresh(q)) continue;
    const lastPrice = Number(q?.price);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
    await processBoxFsmForProgram(program, box, lastPrice, live);
  }
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
async function tickProgram(program) {
  if (!isBoxRangeProgram(program)) return;
  if (program.markets?.kr) await tickCatalogProgram(program, "kr");
  if (program.markets?.us) await tickCatalogProgram(program, "us");
  if (program.markets?.crypto) await tickCryptoProgram(program);
}

export async function tickBoxRangeTrading() {
  reconcileBoxRangeLotsFromPortfolioSync();

  const programs = [
    ...listSimActiveProgramsSync().filter(isBoxRangeProgram),
    ...listArmedLiveTradeProgramsSync().filter(isBoxRangeProgram),
  ];
  if (!programs.length) {
    await syncBoxRangeWsSubscriptions();
    return { programs: 0 };
  }

  await syncBoxRangeWsSubscriptions();

  for (const p of programs) {
    try {
      await tickProgram(p);
    } catch (e) {
      liveTradeLogWarn(
        "[box-range]",
        p.name,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return { programs: programs.length };
}

export function startBoxRangeRunnerPoller() {
  if (process.env.STOCK_BOX_RANGE_RUNNER === "0") return;
  const g = /** @type {typeof globalThis & { __stockBoxRangeRunner?: boolean }} */ (
    globalThis
  );
  if (g.__stockBoxRangeRunner) return;
  g.__stockBoxRangeRunner = true;
  reconcileBoxRangeLotsFromPortfolioSync();
  let running = false;
  const loop = () => {
    if (running) return;
    running = true;
    tickBoxRangeTrading()
      .catch((e) => {
        liveTradeLogWarn(
          "[box-range:tick]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };
  loop();
  setInterval(loop, TICK_MS);
}
