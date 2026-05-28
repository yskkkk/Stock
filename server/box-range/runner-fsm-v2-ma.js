/**
 * Pine `pine-box-range-pro-v2-ma-strategy.pine` FSM — afterBox·MA·dipLow/bottom SL·50% TP·트레일
 */
import {
  touchLiveTradeProgramRunSync,
} from "../live-trade-programs-store.js";
import {
  recordLiveTradeBuyAsync,
  recordLiveTradeBuySync,
  recordLiveTradeSellSync,
} from "../live-trade-portfolio-store.js";
import {
  normalizeSellQuantity,
  resolveOrderAmountForMarket,
} from "../live-trade-market.js";
import {
  executeBithumbLiveBuyOrder,
  executeBithumbLiveSellOrder,
  yahooSymbolToBithumbMarket,
} from "../bithumb-trading-adapter.js";
import {
  executeLiveBuyOrder,
  executeLiveSellOrder,
} from "../toss-trading-adapter.js";
import { getDecryptedCredentialsSync } from "../user-credentials-store.js";
import { isProgramArmedForMarket } from "../live-trade-arm-gate.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";
import { loadStock } from "../stock-data.js";
import {
  countOpenBoxLotsSync,
  patchBoxSync,
} from "./store.js";
import { boxRangeBuyDedupeKey } from "./buy-guard.js";
import { resolveBoxSellQuantitySync } from "./lot-reconcile.js";
import { markCatalogBoxConsumedSync } from "./catalog-store.js";
import { getBoxRangeV2MaProfile } from "./v2-ma-models.js";

/** @type {Set<string>} */
const boxBuyInFlight = new Set();
/** @type {Set<string>} */
const boxSellInFlight = new Set();

/** @type {Map<string, { at: number; uptrend: boolean }>} */
const uptrendCache = new Map();
const UPTREND_TTL_MS = 10 * 60_000;

function sma(values, len) {
  const n = Math.floor(Number(len));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Array.isArray(values) || values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

/**
 * @param {string} symbol
 * @param {boolean} maStrict
 */
async function isDailyUptrend(symbol, maStrict) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return true;
  const cacheKey = `${sym}:${maStrict ? "s" : "r"}`;
  const now = Date.now();
  const cached = uptrendCache.get(cacheKey);
  if (cached && now - cached.at <= UPTREND_TTL_MS) return cached.uptrend;
  try {
    const data = await loadStock(sym, "1d", { live: true, scan: true });
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    const closes = candles
      .map((c) => Number(c?.close))
      .filter((v) => Number.isFinite(v) && v > 0);
    const ma5 = sma(closes, 5);
    const ma20 = sma(closes, 20);
    const ma120 = sma(closes, 120);
    const up =
      ma5 != null &&
      ma20 != null &&
      (maStrict
        ? ma120 != null && ma5 > ma20 && ma20 > ma120
        : ma5 > ma20);
    uptrendCache.set(cacheKey, { at: now, uptrend: Boolean(up) });
    return Boolean(up);
  } catch {
    uptrendCache.set(cacheKey, { at: now, uptrend: true });
    return true;
  }
}

/**
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {string} [reason]
 */
function closeTradingBox(box, reason = "closed") {
  patchBoxSync(box.boxId, {
    state: "closed",
    tradeEligible: false,
    lotQty: 0,
    buyTradeId: null,
    entryPrice: null,
    buyAtMs: null,
    breakAtMs: null,
    dipLow: null,
    confirmingAtMs: null,
    tp1Done: false,
    peakAfterTp: null,
  });
  const cid = String(box.catalogBoxId ?? "").trim();
  if (cid) markCatalogBoxConsumedSync(cid, reason);
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {import("./store.js").BoxRangeRecord} box
 */
function boxMarketForProgram(program, box) {
  if (
    box.catalogMarket === "kr" ||
    box.catalogMarket === "us" ||
    box.catalogMarket === "crypto"
  ) {
    return box.catalogMarket;
  }
  if (box.catalogBoxId) {
    if (program.markets?.us) return "us";
    if (program.markets?.kr) return "kr";
  }
  if (program.markets?.crypto) return "crypto";
  if (program.markets?.us) return "us";
  if (program.markets?.kr) return "kr";
  return "us";
}

/**
 * @param {import("./v2-ma-models.js").BoxRangeV2MaProfile} profile
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} lastPrice
 */
function initialStopPrice(profile, box, lastPrice) {
  if (profile.stopMode === "bottom") return box.bottom;
  const dip = box.dipLow ?? lastPrice;
  return dip;
}

/**
 * @param {import("./v2-ma-models.js").BoxRangeV2MaProfile} profile
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} trailStop
 */
function trailFloor(profile, box, trailStop) {
  if (profile.stopMode === "bottom") {
    return Math.max(trailStop, box.bottom);
  }
  const dip = box.dipLow;
  if (dip != null && Number.isFinite(dip)) return Math.max(trailStop, dip);
  return trailStop;
}

/**
 * @param {import("./v2-ma-models.js").BoxRangeV2MaProfile} profile
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} lastPrice
 */
function hitInitialStop(profile, box, lastPrice) {
  if (profile.stopMode === "bottom") return lastPrice <= box.bottom;
  const dip = box.dipLow;
  return dip != null && Number.isFinite(dip) && lastPrice <= dip;
}

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} lastPrice
 * @param {boolean} live
 */
export async function processBoxFsmV2Ma(program, box, lastPrice, live) {
  const profile = getBoxRangeV2MaProfile(program.modelId);
  if (!profile) return;

  const sym = box.symbol;
  const market = boxMarketForProgram(program, box);
  const sim = program.status === "sim";
  const now = Date.now();
  const userId = String(program.userId ?? "").trim();

  if (!live && !sim) return;

  if (box.dead === true) {
    closeTradingBox(box, "dead");
    return;
  }

  const rightMs = Number(box.rightTime) > 0 ? Number(box.rightTime) * 1000 : 0;
  const afterBox = rightMs > 0 && now > rightMs;

  if (box.state === "idle") {
    if (afterBox && lastPrice <= box.bottom) {
      patchBoxSync(box.boxId, {
        state: "armed",
        armedAtMs: now,
        breakAtMs: now,
        dipLow: lastPrice,
      });
    }
    return;
  }

  if (box.state === "armed") {
    if (!afterBox) return;

    const nextDip =
      box.dipLow == null || lastPrice < box.dipLow ? lastPrice : box.dipLow;
    if (nextDip !== box.dipLow) patchBoxSync(box.boxId, { dipLow: nextDip });

    if (lastPrice < box.bottom) return;

    const up = await isDailyUptrend(sym, profile.maStrict);
    if (!up) return;

    const openLots = countOpenBoxLotsSync(program.id);
    if (openLots >= program.maxOpenPositions) return;

    const dedupe = boxRangeBuyDedupeKey(program.id, box.boxId, sym);
    if (boxBuyInFlight.has(dedupe)) return;
    boxBuyInFlight.add(dedupe);

    const entryPrice = box.bottom;
    const stopLoss = initialStopPrice(profile, { ...box, dipLow: nextDip }, lastPrice);
    let runErr = null;

    try {
      const pick = {
        symbol: sym,
        market,
        price: entryPrice,
        name: sym,
        score: 1,
        signalIds: [`box-range:${box.timeframe}:${profile.id}`],
      };
      const boxMeta = { boxId: box.boxId, boxTimeframe: box.timeframe };

      if (live && isProgramArmedForMarket(program, market)) {
        let trade = null;
        let liveFillPrice = entryPrice;
        if (market === "crypto") {
          const out = await executeBithumbLiveBuyOrder(program, pick, {
            credentials: getDecryptedCredentialsSync(userId, "bithumb"),
          });
          if (!out.ok) throw new Error(out.error ?? "매수 실패");
          liveFillPrice = out.fillPrice ?? entryPrice;
          trade = await recordLiveTradeBuyAsync(
            program,
            { ...pick, price: liveFillPrice },
            {
              simulated: out.simulated,
              orderId: out.orderId,
              fillVolume: out.fillVolume ?? undefined,
              ...boxMeta,
              targetSellPrice: box.top,
              stopLossPrice: stopLoss,
            },
          );
        } else {
          const out = await executeLiveBuyOrder(program, pick, { userId });
          if (!out.ok) throw new Error(out.error ?? "매수 실패");
          liveFillPrice = out.fillPrice ?? entryPrice;
          const orderAmount = await resolveOrderAmountForMarket(program, market);
          trade = recordLiveTradeBuySync(
            program,
            { ...pick, price: liveFillPrice },
            {
              simulated: out.simulated,
              orderId: out.orderId,
              fillVolume: out.fillVolume ?? undefined,
              ...boxMeta,
            },
            {
              targetSellPrice: box.top,
              stopLossPrice: stopLoss,
              exitScenarioNote: `box:${box.boxId}`,
              entryKind: `box:${box.timeframe}`,
              entryStructureNote: "박스권 V2+MA",
            },
            orderAmount,
          );
        }
        if (trade) {
          patchBoxSync(box.boxId, {
            state: "in_position",
            buyTradeId: trade.id,
            lotQty: trade.quantity,
            entryPrice: liveFillPrice,
            buyAtMs: trade.atMs,
            dipLow: profile.stopMode === "dipLow" ? nextDip : box.dipLow,
            tp1Done: false,
            peakAfterTp: null,
          });
          liveTradeLogInfo("[box-range-v2-ma:buy]", program.name, sym, profile.id);
        }
      } else if (!live && program.simAutoBuy !== false) {
        const trade = await recordLiveTradeBuyAsync(program, pick, {
          simulated: true,
          ...boxMeta,
          targetSellPrice: box.top,
          stopLossPrice: stopLoss,
        });
        if (trade) {
          patchBoxSync(box.boxId, {
            state: "in_position",
            buyTradeId: trade.id,
            lotQty: trade.quantity,
            entryPrice: entryPrice,
            buyAtMs: trade.atMs,
            dipLow: profile.stopMode === "dipLow" ? nextDip : box.dipLow,
            tp1Done: false,
            peakAfterTp: null,
          });
          liveTradeLogInfo("[box-range-v2-ma:sim-buy]", program.name, sym, profile.id);
        }
      }
    } catch (e) {
      runErr = e instanceof Error ? e.message : String(e);
      liveTradeLogWarn("[box-range-v2-ma:buy]", program.name, sym, runErr);
    } finally {
      boxBuyInFlight.delete(dedupe);
      touchLiveTradeProgramRunSync(program.id, runErr);
    }
    return;
  }

  if (box.state !== "in_position") return;

  const sellKey = `${program.id}:${box.boxId}`;
  if (boxSellInFlight.has(sellKey)) return;

  const lot = resolveBoxSellQuantitySync(box);
  if (lot.closed) {
    closeTradingBox(box, "reconciled");
    return;
  }
  const qty = lot.quantity;
  if (qty <= 0) return;
  const entry = lot.entryPrice ?? box.entryPrice ?? box.bottom;

  if (hitInitialStop(profile, box, lastPrice)) {
    await executeV2MaSell({
      program,
      box,
      market,
      sym,
      userId,
      live,
      qty,
      fillPrice:
        profile.stopMode === "bottom" ? box.bottom : (box.dipLow ?? lastPrice),
      entry,
      exitSide: "sl",
      deadAfter: true,
      sellKey,
    });
    return;
  }

  const partialPct = profile.partialTpPct;
  const didTp1 = box.tp1Done === true;

  if (!didTp1 && lastPrice >= box.top && partialPct > 0 && partialPct < 100) {
    let sellQty = qty * (partialPct / 100);
    sellQty = normalizeSellQuantity(sellQty, market);
    if (sellQty > 0 && sellQty < qty) {
      await executeV2MaSell({
        program,
        box,
        market,
        sym,
        userId,
        live,
        qty: sellQty,
        fillPrice: box.top,
        entry,
        exitSide: "tp1",
        deadAfter: false,
        sellKey,
        afterPatch: {
          tp1Done: true,
          peakAfterTp: lastPrice,
          lotQty: qty - sellQty,
        },
      });
      return;
    }
  }

  if (didTp1) {
    const prevPeak = box.peakAfterTp;
    const newPeak =
      prevPeak == null || !Number.isFinite(prevPeak)
        ? lastPrice
        : Math.max(prevPeak, lastPrice);
    if (newPeak !== prevPeak) {
      patchBoxSync(box.boxId, { peakAfterTp: newPeak });
    }
    const trailStop = newPeak * (1 - profile.trailPct / 100);
    const stopPx = trailFloor(profile, box, trailStop);
    if (lastPrice <= stopPx) {
      await executeV2MaSell({
        program,
        box,
        market,
        sym,
        userId,
        live,
        qty,
        fillPrice: stopPx,
        entry,
        exitSide: "trail",
        deadAfter: true,
        sellKey,
      });
    }
  } else if (!didTp1 && lastPrice >= box.top) {
    await executeV2MaSell({
      program,
      box,
      market,
      sym,
      userId,
      live,
      qty,
      fillPrice: box.top,
      entry,
      exitSide: "tp",
      deadAfter: true,
      sellKey,
    });
  }
}

/**
 * @param {object} opts
 */
async function executeV2MaSell(opts) {
  const {
    program,
    box,
    market,
    sym,
    userId,
    live,
    qty,
    fillPrice,
    entry,
    exitSide,
    deadAfter,
    sellKey,
    afterPatch,
  } = opts;

  if (boxSellInFlight.has(sellKey)) return;
  boxSellInFlight.add(sellKey);
  const now = Date.now();

  try {
    let soldQty = qty;
    let outFill = fillPrice;
    let simulated = !live;

    if (live && isProgramArmedForMarket(program, market)) {
      if (market === "crypto") {
        const bithumbMarket = yahooSymbolToBithumbMarket(sym);
        if (!bithumbMarket) throw new Error("빗썸 마켓을 찾을 수 없습니다.");
        const out = await executeBithumbLiveSellOrder(
          { market: bithumbMarket, volume: qty },
          {
            credentials: getDecryptedCredentialsSync(userId, "bithumb"),
            userId,
          },
        );
        if (!out.ok) throw new Error(out.error ?? "매도 실패");
        outFill = out.fillPrice ?? fillPrice;
        simulated = Boolean(out.simulated);
        if (Number(out.fillVolume) > 0) soldQty = Number(out.fillVolume);
      } else {
        const out = await executeLiveSellOrder(
          program,
          { symbol: sym, market, quantity: qty, price: fillPrice },
          { userId },
        );
        if (!out.ok) throw new Error(out.error ?? "매도 실패");
        outFill = out.fillPrice ?? fillPrice;
        simulated = Boolean(out.simulated);
      }
    }

    recordLiveTradeSellSync(
      {
        programId: program.id,
        symbol: sym,
        market,
        quantity: soldQty,
        price: outFill,
        note: `box:${box.boxId}:${exitSide}`,
        simulated,
        boxId: box.boxId,
        boxTimeframe: box.timeframe,
        entryPrice: entry,
        atMs: now,
      },
      userId,
    );

    if (deadAfter) {
      patchBoxSync(box.boxId, { dead: true, tp1Done: false, peakAfterTp: null });
      closeTradingBox(box, exitSide);
    } else if (afterPatch) {
      patchBoxSync(box.boxId, { state: "in_position", ...afterPatch });
    }

    liveTradeLogInfo(
      "[box-range-v2-ma:sell]",
      program.name,
      sym,
      exitSide,
      box.timeframe,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[box-range-v2-ma:sell]", program.name, sym, msg);
    touchLiveTradeProgramRunSync(program.id, msg);
  } finally {
    boxSellInFlight.delete(sellKey);
  }
}
