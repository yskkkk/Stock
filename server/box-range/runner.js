import {
  listArmedLiveTradeProgramsSync,
  listSimActiveProgramsSync,
  touchLiveTradeProgramRunSync,
} from "../live-trade-programs-store.js";
import { loadStock } from "../stock-data.js";
import { fetchQuoteSnapshotsForSymbols } from "../picks-live-quotes.js";
import { pickQuoteFromMap } from "../quote-symbol-resolve.js";
import { loadCryptoWatchlistTen } from "../crypto-universe.js";
import {
  recordLiveTradeBuyAsync,
  recordLiveTradeSellSync,
} from "../live-trade-portfolio-store.js";
import {
  executeBithumbLiveBuyOrder,
  executeBithumbLiveSellOrder,
  yahooSymbolToBithumbMarket,
} from "../bithumb-trading-adapter.js";
import { getDecryptedCredentialsSync } from "../user-credentials-store.js";
import { isProgramArmedForMarket } from "../live-trade-arm-gate.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";
import { BOX_RANGE_TIMEFRAMES, isBoxRangeProgram } from "./constants.js";
import { detectBoxRangeOnCandles } from "./detect.js";
import {
  countOpenBoxLotsSync,
  listBoxesForProgramSync,
  patchBoxSync,
  upsertDetectedBoxSync,
} from "./store.js";
import { boxRangeBuyDedupeKey } from "./buy-guard.js";

const TICK_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_TICK_MS ?? 3_000);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 30_000) : 3_000;
})();

const MAX_SYMBOLS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_MAX_SYMBOLS ?? 10);
  return Number.isFinite(n) && n >= 3 ? Math.min(n, 20) : 10;
})();

/** @type {Set<string>} */
const boxBuyInFlight = new Set();

/** @type {Map<string, number>} */
const lastDetectRightTime = new Map();

function detectKey(programId, symbol, tf) {
  return `${programId}:${symbol}:${tf}`;
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
async function resolveWatchSymbols(program) {
  const fromBoxes = new Set(
    listBoxesForProgramSync(program.id).map((b) => b.symbol),
  );
  try {
    const uni = await loadCryptoWatchlistTen();
    for (const a of uni.assets.slice(0, MAX_SYMBOLS)) {
      fromBoxes.add(a.symbol);
    }
  } catch {
    fromBoxes.add("BTC-USDT");
  }
  return [...fromBoxes].slice(0, MAX_SYMBOLS);
}

/**
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
async function loadCandlesForBoxTf(symbol, timeframe) {
  const data = await loadStock(symbol, timeframe, { live: true });
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  return candles.filter(
    (c) =>
      c &&
      Number.isFinite(c.time) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low),
  );
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
async function runDetectionForTf(program, symbol, timeframe) {
  const candles = await loadCandlesForBoxTf(symbol, timeframe);
  if (candles.length < 20) return;
  const confirmed = candles.slice(0, -1);
  const detected = detectBoxRangeOnCandles(confirmed, timeframe);
  if (!detected) return;
  const dk = detectKey(program.id, symbol, timeframe);
  const prev = lastDetectRightTime.get(dk) ?? 0;
  if (detected.rightTime <= prev) return;
  lastDetectRightTime.set(dk, detected.rightTime);
  upsertDetectedBoxSync({
    programId: program.id,
    userId: String(program.userId ?? "").trim(),
    symbol,
    timeframe,
    top: detected.top,
    bottom: detected.bottom,
    mid: detected.mid,
    leftTime: detected.leftTime,
    rightTime: detected.rightTime,
  });
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} lastPrice
 * @param {boolean} live
 */
async function processBoxFsm(program, box, lastPrice, live) {
  if (box.state === "closed") return;
  const sym = box.symbol;
  const now = Date.now();

  if (box.state === "idle") {
    if (lastPrice <= box.bottom) {
      patchBoxSync(box.boxId, {
        state: "armed",
        armedAtMs: now,
        breakAtMs: now,
      });
    }
    return;
  }

  if (box.state === "armed") {
    const broke = box.breakAtMs != null;
    if (broke && lastPrice >= box.mid) {
      const openLots = countOpenBoxLotsSync(program.id);
      if (openLots >= program.maxOpenPositions) return;

      const dedupe = boxRangeBuyDedupeKey(program.id, box.boxId, sym);
      if (boxBuyInFlight.has(dedupe)) return;
      boxBuyInFlight.add(dedupe);

      let runErr = null;
      try {
        const pick = {
          symbol: sym,
          market: "crypto",
          price: box.mid,
          name: sym,
          score: 1,
          signalIds: [`box-range:${box.timeframe}`],
        };
        const boxMeta = { boxId: box.boxId, boxTimeframe: box.timeframe };

        if (live && isProgramArmedForMarket(program, "crypto")) {
          const userId = String(program.userId ?? "").trim();
          const out = await executeBithumbLiveBuyOrder(program, pick, {
            credentials: getDecryptedCredentialsSync(userId, "bithumb"),
          });
          if (!out.ok) throw new Error(out.error ?? "매수 실패");
          const trade = await recordLiveTradeBuyAsync(
            program,
            { ...pick, price: out.fillPrice ?? box.mid },
            {
              simulated: out.simulated,
              orderId: out.orderId,
              ...boxMeta,
            },
          );
          if (trade) {
            patchBoxSync(box.boxId, {
              state: "in_position",
              buyTradeId: trade.id,
              lotQty: trade.quantity,
              entryPrice: trade.price,
            });
            liveTradeLogInfo("[box-range:buy]", program.name, sym, box.timeframe, trade.quantity);
          }
        } else if (!live && program.simAutoBuy !== false) {
          const trade = await recordLiveTradeBuyAsync(
            program,
            pick,
            { simulated: true, ...boxMeta },
          );
          if (trade) {
            patchBoxSync(box.boxId, {
              state: "in_position",
              buyTradeId: trade.id,
              lotQty: trade.quantity,
              entryPrice: trade.price,
            });
            liveTradeLogInfo("[box-range:sim-buy]", program.name, sym, box.timeframe);
          }
        }
      } catch (e) {
        runErr = e instanceof Error ? e.message : String(e);
        liveTradeLogWarn("[box-range:buy]", program.name, sym, runErr);
      } finally {
        boxBuyInFlight.delete(dedupe);
        touchLiveTradeProgramRunSync(program.id, runErr);
      }
    }
    return;
  }

  if (box.state === "in_position" && box.lotQty > 0) {
    const qty = box.lotQty;
    const entry = box.entryPrice ?? box.mid;
    let exitSide = null;
    let fillPrice = lastPrice;
    if (lastPrice >= box.top) {
      exitSide = "tp";
      fillPrice = box.top;
    } else if (lastPrice <= box.bottom) {
      exitSide = "sl";
      fillPrice = box.bottom;
    }
    if (!exitSide) return;

    try {
      if (live && isProgramArmedForMarket(program, "crypto")) {
        const userId = String(program.userId ?? "").trim();
        const bithumbMarket = yahooSymbolToBithumbMarket(sym);
        if (!bithumbMarket) throw new Error("빗썸 마켓을 찾을 수 없습니다.");
        const out = await executeBithumbLiveSellOrder(
          { market: bithumbMarket, volume: qty },
          {
            credentials: getDecryptedCredentialsSync(userId, "bithumb"),
          },
        );
        if (!out.ok) throw new Error(out.error ?? "매도 실패");
        recordLiveTradeSellSync(
          {
            programId: program.id,
            symbol: sym,
            market: "crypto",
            quantity: qty,
            price: out.fillPrice ?? fillPrice,
            note: `box:${box.boxId}:${exitSide}`,
            orderId: out.orderId,
            simulated: out.simulated,
            boxId: box.boxId,
            boxTimeframe: box.timeframe,
            entryPrice: entry,
          },
          userId,
        );
      } else if (!live) {
        recordLiveTradeSellSync(
          {
            programId: program.id,
            symbol: sym,
            market: "crypto",
            quantity: qty,
            price: fillPrice,
            note: `box:${box.boxId}:${exitSide}`,
            simulated: true,
            boxId: box.boxId,
            boxTimeframe: box.timeframe,
            entryPrice: entry,
          },
          String(program.userId ?? "").trim(),
        );
      }
      patchBoxSync(box.boxId, {
        state: "closed",
        lotQty: 0,
        buyTradeId: null,
        entryPrice: null,
      });
      liveTradeLogInfo("[box-range:sell]", program.name, sym, exitSide, box.timeframe);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      liveTradeLogWarn("[box-range:sell]", program.name, sym, msg);
      touchLiveTradeProgramRunSync(program.id, msg);
    }
  }
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 */
async function tickProgram(program) {
  if (!program.markets?.crypto) return;
  const symbols = await resolveWatchSymbols(program);
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

  const quotes = await fetchQuoteSnapshotsForSymbols(symbols);
  const boxes = listBoxesForProgramSync(program.id);

  for (const box of boxes) {
    const q = pickQuoteFromMap(quotes, box.symbol);
    const lastPrice = Number(q?.price);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
    if (live || sim) {
      await processBoxFsm(program, box, lastPrice, live);
    }
  }
}

export async function tickBoxRangeTrading() {
  const programs = [
    ...listSimActiveProgramsSync().filter(isBoxRangeProgram),
    ...listArmedLiveTradeProgramsSync().filter(isBoxRangeProgram),
  ];
  if (!programs.length) return { programs: 0 };
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
