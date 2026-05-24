/**
 * 시뮬·실매매 보유 — 매도 전략(단기·중기·장기) + 목표·손절 자동 매도
 */
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { pickQuoteFromMap } from "./quote-symbol-resolve.js";
import {
  getLiveTradeProgramSync,
  listArmedLiveTradeProgramsSync,
  listSimActiveProgramsSync,
} from "./live-trade-programs-store.js";
import {
  buildOpenPositionsWithSellTargetsSync,
  recordLiveTradeSellSync,
} from "./live-trade-portfolio-store.js";
import {
  executeBithumbLiveSellOrder,
  yahooSymbolToBithumbMarket,
} from "./bithumb-trading-adapter.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { getRoundTripFeeRateForUserMarketSync } from "./exchange-trading-fees.js";
import {
  evaluateLiveTradeSellDecision,
  loadCandlesForSellHorizon,
  resolveProgramSellHorizon,
} from "./live-trade-sell-strategy.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_LIVE_TRADE_AUTO_SELL_MS ?? 45_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(n, 120_000) : 45_000;
})();

/**
 * @param {ReturnType<typeof buildOpenPositionsWithSellTargetsSync>[number]} pos
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {number | null} currentPrice
 * @param {unknown[]} candles
 */
function resolveSellHit(pos, program, currentPrice, candles) {
  const userId = String(program.userId ?? "").trim();
  const roundTripFeeRate = userId
    ? getRoundTripFeeRateForUserMarketSync(userId, pos.market)
    : undefined;
  return evaluateLiveTradeSellDecision(pos, program, currentPrice, candles, {
    roundTripFeeRate,
  });
}

export async function tickLiveTradeAutoSell() {
  const simPrograms = listSimActiveProgramsSync();
  const armedPrograms = listArmedLiveTradeProgramsSync();
  const activePrograms = [...simPrograms, ...armedPrograms];
  if (!activePrograms.length) return { sold: 0 };

  const activePids = new Set(activePrograms.map((p) => p.id));
  const positions = buildOpenPositionsWithSellTargetsSync().filter((p) =>
    activePids.has(p.programId),
  );
  if (!positions.length) return { sold: 0 };

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const quotes = await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 });

  /** @type {Map<string, unknown[]>} */
  const candleCache = new Map();
  /** @type {Map<string, Promise<unknown[]>>} */
  const candleInflight = new Map();

  /**
   * @param {string} symbol
   * @param {import("./live-trade-sell-strategy.js").LiveTradeSellHorizon} horizon
   */
  async function getCandles(symbol, horizon) {
    const key = `${horizon}:${symbol}`;
    if (candleCache.has(key)) return candleCache.get(key) ?? [];
    if (!candleInflight.has(key)) {
      candleInflight.set(
        key,
        loadCandlesForSellHorizon(symbol, horizon).then((rows) => {
          candleCache.set(key, rows);
          candleInflight.delete(key);
          return rows;
        }),
      );
    }
    return candleInflight.get(key) ?? [];
  }

  const horizonSymbols = new Map();
  for (const pos of positions) {
    const program = getLiveTradeProgramSync(pos.programId);
    if (!program?.autoSellAtTarget) continue;
    const horizon = resolveProgramSellHorizon(program);
    const set = horizonSymbols.get(horizon) ?? new Set();
    set.add(pos.symbol);
    horizonSymbols.set(horizon, set);
  }
  await Promise.all(
    [...horizonSymbols.entries()].flatMap(([horizon, symSet]) =>
      [...symSet].map((sym) => getCandles(sym, horizon)),
    ),
  );

  let sold = 0;

  for (const pos of positions) {
    const program = getLiveTradeProgramSync(pos.programId);
    if (!program) continue;
    if (!program.autoSellAtTarget) continue;

    const isArmed = program.status === "armed";
    const isSim = program.status === "sim";
    if (!isArmed && !isSim) continue;

    const q = pickQuoteFromMap(quotes, pos.symbol, pos.market);
    const current =
      q?.price != null && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
    const horizon = resolveProgramSellHorizon(program);
    const candles = candleCache.get(`${horizon}:${pos.symbol}`) ?? [];
    const hit = resolveSellHit(pos, program, current, candles);
    if (!hit) continue;

    try {
      if (isArmed && pos.market === "crypto") {
        const bithumbMarket = yahooSymbolToBithumbMarket(pos.symbol);
        if (!bithumbMarket) {
          console.warn("[live-trade:auto-sell] 빗썸 마켓 변환 실패:", pos.symbol);
          continue;
        }
        const userId = String(program.userId ?? "").trim();
        const credentials = userId ? getDecryptedCredentialsSync(userId, "bithumb") : null;
        const sellResult = await executeBithumbLiveSellOrder(
          { market: bithumbMarket, volume: pos.quantity },
          { credentials },
        );
        if (!sellResult.ok) {
          console.warn("[live-trade:auto-sell] 빗썸 매도 실패:", pos.symbol, sellResult.error);
          continue;
        }
        const fillPrice = sellResult.fillPrice ?? hit.price ?? current;
        recordLiveTradeSellSync({
          programId: pos.programId,
          symbol: pos.symbol,
          market: pos.market,
          quantity: pos.quantity,
          price: fillPrice,
          note: hit.note,
          simulated: Boolean(sellResult.simulated),
          orderId: sellResult.orderId ?? null,
          atMs: Date.now(),
        });
        console.info(
          "[live-trade:auto-sell:armed]",
          pos.symbol,
          hit.note,
          fillPrice,
          sellResult.simulated ? "(simulated)" : "",
        );
      } else {
        recordLiveTradeSellSync({
          programId: pos.programId,
          symbol: pos.symbol,
          market: pos.market,
          quantity: pos.quantity,
          price: hit.price ?? current,
          note: hit.note,
          simulated: true,
          atMs: Date.now(),
        });
        console.info(
          "[live-trade:auto-sell]",
          pos.symbol,
          hit.note,
          hit.price ?? current,
        );
      }
      sold++;
    } catch (e) {
      console.warn(
        "[live-trade:auto-sell]",
        pos.symbol,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return { sold };
}

export function startLiveTradeAutoSellPoller() {
  if (process.env.STOCK_LIVE_TRADE_AUTO_SELL === "0") return;
  const g = /** @type {typeof globalThis & { __stockLiveTradeAutoSellStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockLiveTradeAutoSellStarted) return;
  g.__stockLiveTradeAutoSellStarted = true;
  const run = () => {
    void tickLiveTradeAutoSell().catch((e) => {
      console.warn(
        "[live-trade:auto-sell]",
        e instanceof Error ? e.message : e,
      );
    });
  };
  run();
  setInterval(run, POLL_MS);
}
