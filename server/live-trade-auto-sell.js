/**

 * 시뮬·실매매 보유 — 매도 전략(단기·중기·장기) + 목표·손절 자동 매도

 */

import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";

import { pickQuoteFromMap } from "./quote-symbol-resolve.js";

import {

  getLiveTradeProgramForRunnerSync,

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

import { usdtSymbolToBithumbBase } from "./bithumb-krw.js";

import {
  EXCHANGE_ZERO_RATIO,
  clampBithumbSellVolumeToAvailable,
  getBithumbExchangeQtyMaps,
  findAskFillAfter,
  listBithumbDoneOrdersForMarket,
} from "./live-trade-bithumb-reconcile.js";

import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

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

    const program = getLiveTradeProgramForRunnerSync(pos.programId);

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



  // ── 빗썸 실잔고 체크: armed crypto 포지션이 거래소에 없으면 수동매도로 처리 ──
  /** @type {Map<string, Map<string, number>>} userId → (base → total qty) */
  const userExchangeTotalMap = new Map();
  /** @type {Map<string, Map<string, number>>} userId → (base → orderable qty) */
  const userExchangeAvailableMap = new Map();
  {
    /** @type {Map<string, import("./bithumb-trading-adapter.js").BithumbCredentials>} */
    const uidCredMap = new Map();
    for (const prog of armedPrograms) {
      if (!prog.markets?.crypto) continue;
      const uid = String(prog.userId ?? "").trim();
      if (!uid || uidCredMap.has(uid)) continue;
      const creds = getDecryptedCredentialsSync(uid, "bithumb");
      if (creds?.apiKey && creds?.secretKey) uidCredMap.set(uid, creds);
    }
    await Promise.all(
      [...uidCredMap.entries()].map(async ([uid, creds]) => {
        try {
          const { total, available } = await getBithumbExchangeQtyMaps(creds);
          userExchangeTotalMap.set(uid, total);
          userExchangeAvailableMap.set(uid, available);
        } catch (e) {
          liveTradeLogWarn(
            "[live-trade:auto-sell] 잔고 조회 실패:",
            uid,
            e instanceof Error ? e.message : e,
          );
        }
      }),
    );
  }

  /** 이번 틱에 수동매도로 처리된 포지션 키 (메인 루프에서 건너뜀) */
  const manuallyClosedKeys = new Set();

  for (const pos of positions) {
    const prog = getLiveTradeProgramForRunnerSync(pos.programId);
    if (prog?.status !== "armed" || pos.market !== "crypto") continue;

    const uid = String(prog.userId ?? "").trim();
    const qtyMap = userExchangeTotalMap.get(uid);
    if (!qtyMap) continue; // 잔고 조회 실패 → 이번 틱 건너뜀

    const base = usdtSymbolToBithumbBase(pos.symbol);
    if (!base) continue;

    const exQty = qtyMap.get(base) ?? 0;
    if (exQty >= pos.quantity * EXCHANGE_ZERO_RATIO) continue; // 정상 보유 중

    // 거래소 잔고 없음 → 수동매도 감지
    const posKey = `${pos.programId}:${pos.market}:${pos.symbol}`;
    const creds = getDecryptedCredentialsSync(uid, "bithumb");
    let sellPrice = null;
    let orderId = null;
    let atMs = Date.now();

    if (creds) {
      try {
        const orders = await listBithumbDoneOrdersForMarket(
          creds,
          `KRW-${base}`,
          { limit: 100 },
        );
        const fill = findAskFillAfter(orders, pos.boughtAtMs ?? 0);
        if (fill) {
          sellPrice = fill.price;
          orderId = fill.orderId;
          atMs = fill.atMs;
        }
      } catch (e) {
        liveTradeLogWarn(
          "[live-trade:auto-sell] 체결내역 조회 실패:",
          pos.symbol,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 체결내역 없으면 현재가 기준으로 기록
    if (sellPrice == null) {
      const q = pickQuoteFromMap(quotes, pos.symbol, pos.market);
      if (q?.price != null && Number.isFinite(q.price) && q.price > 0) {
        sellPrice = q.price;
      }
    }

    if (sellPrice == null || sellPrice <= 0) {
      liveTradeLogWarn(
        "[live-trade:auto-sell] 수동매도 감지 — 가격 불명, 건너뜀:",
        pos.symbol,
      );
      manuallyClosedKeys.add(posKey);
      continue;
    }

    try {
      const progForSell = getLiveTradeProgramForRunnerSync(pos.programId);
      if (!progForSell?.userId) continue;
      recordLiveTradeSellSync(
        {
          programId: pos.programId,
          symbol: pos.symbol,
          market: pos.market,
          quantity: pos.quantity,
          price: sellPrice,
          orderId: orderId ?? null,
          atMs,
          simulated: false,
          note: orderId
            ? `빗썸 수동매도 감지·체결 ${orderId}`
            : "빗썸 수동매도 감지 (현재가 기준)",
        },
        progForSell.userId,
      );
      manuallyClosedKeys.add(posKey);
      liveTradeLogInfo(
        "[live-trade:auto-sell] 수동매도 감지·기록:",
        pos.symbol,
        sellPrice,
        orderId ?? "(주문ID 없음)",
      );
    } catch (e) {
      liveTradeLogWarn(
        "[live-trade:auto-sell] 수동매도 기록 실패:",
        pos.symbol,
        e instanceof Error ? e.message : e,
      );
      manuallyClosedKeys.add(posKey);
    }
  }
  // ── 수동매도 감지 끝 ──

  let sold = 0;



  for (const pos of positions) {

    const program = getLiveTradeProgramForRunnerSync(pos.programId);

    if (!program) continue;

    if (!program.autoSellAtTarget) continue;



    const isArmed = program.status === "armed";

    const isSim = program.status === "sim";

    if (!isArmed && !isSim) continue;

    const posKey = `${pos.programId}:${pos.market}:${pos.symbol}`;

    if (manuallyClosedKeys.has(posKey)) continue;

    const q = pickQuoteFromMap(quotes, pos.symbol, pos.market);

    const current =

      q?.price != null && Number.isFinite(q.price) && q.price > 0 ? q.price : null;

    const horizon = resolveProgramSellHorizon(program);

    const candles = candleCache.get(`${horizon}:${pos.symbol}`) ?? [];

    const hit = resolveSellHit(pos, program, current, candles);

    if (!hit) continue;



    try {

      if (isArmed && pos.market === "kr") {

        liveTradeLogWarn(

          "[live-trade:auto-sell] KR 실매매 자동매도 미지원 — 수동 매도 필요:",

          pos.symbol,

          hit.note,

        );

        continue;

      }

      if (isArmed && pos.market === "crypto") {

        const bithumbMarket = yahooSymbolToBithumbMarket(pos.symbol);

        if (!bithumbMarket) {

          liveTradeLogWarn("[live-trade:auto-sell] 빗썸 마켓 변환 실패:", pos.symbol);

          continue;

        }

        const userId = String(program.userId ?? "").trim();

        const credentials = userId ? getDecryptedCredentialsSync(userId, "bithumb") : null;

        const base = usdtSymbolToBithumbBase(pos.symbol);
        const available =
          base && userId
            ? (userExchangeAvailableMap.get(userId)?.get(base) ?? 0)
            : 0;
        const { volume: sellVolume, clamped } = clampBithumbSellVolumeToAvailable(
          pos.quantity,
          available,
        );
        if (sellVolume <= 0) {
          liveTradeLogWarn(
            "[live-trade:auto-sell] 빗썸 주문가능 수량 없음 — 매도 건너뜀:",
            pos.symbol,
            { appQty: pos.quantity, available },
          );
          continue;
        }
        if (clamped) {
          liveTradeLogInfo(
            "[live-trade:auto-sell] 매도 수량 조정(주문가능 한도):",
            pos.symbol,
            sellVolume,
            "/",
            pos.quantity,
          );
        }

        const sellResult = await executeBithumbLiveSellOrder(

          { market: bithumbMarket, volume: sellVolume },

          { credentials },

        );

        if (!sellResult.ok) {

          liveTradeLogWarn("[live-trade:auto-sell] 빗썸 매도 실패:", pos.symbol, sellResult.error);

          continue;

        }

        const fillPrice = sellResult.fillPrice ?? hit.price ?? current;

        recordLiveTradeSellSync(
          {
            programId: pos.programId,
            symbol: pos.symbol,
            market: pos.market,
            quantity: sellVolume,
            price: fillPrice,
            note: hit.note,
            simulated: Boolean(sellResult.simulated),
            orderId: sellResult.orderId ?? null,
            atMs: Date.now(),
          },
          program.userId,
        );

        liveTradeLogInfo(

          "[live-trade:auto-sell:armed]",

          pos.symbol,

          hit.note,

          fillPrice,

          sellResult.simulated ? "(simulated)" : "",

        );

      } else {

        recordLiveTradeSellSync(
          {
            programId: pos.programId,
            symbol: pos.symbol,
            market: pos.market,
            quantity: pos.quantity,
            price: hit.price ?? current,
            note: hit.note,
            simulated: true,
            atMs: Date.now(),
          },
          program.userId,
        );

        liveTradeLogInfo(

          "[live-trade:auto-sell]",

          pos.symbol,

          hit.note,

          hit.price ?? current,

        );

      }

      sold++;

    } catch (e) {

      liveTradeLogWarn(

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

  let running = false;

  const loop = () => {

    if (running) return;

    running = true;

    tickLiveTradeAutoSell()

      .catch((e) => {

        liveTradeLogWarn(

          "[live-trade:auto-sell]",

          e instanceof Error ? e.message : e,

        );

      })

      .finally(() => {

        running = false;

        setTimeout(loop, POLL_MS);

      });

  };

  loop();

}


