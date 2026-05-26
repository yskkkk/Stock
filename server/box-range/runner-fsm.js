import {
  touchLiveTradeProgramRunSync,
} from "../live-trade-programs-store.js";
import {
  recordLiveTradeBuyAsync,
  recordLiveTradeBuySync,
  recordLiveTradeSellSync,
} from "../live-trade-portfolio-store.js";
import { resolveOrderAmountForMarket } from "../live-trade-market.js";
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
import {
  countOpenBoxLotsSync,
  patchBoxSync,
} from "./store.js";
import { boxRangeBuyDedupeKey } from "./buy-guard.js";
import { resolveBoxSellQuantitySync } from "./lot-reconcile.js";
import { markCatalogBoxConsumedSync } from "./catalog-store.js";
import { notifyBoxRangeMidEntry } from "./box-range-telegram.js";

/** @type {Set<string>} */
const boxBuyInFlight = new Set();
/** @type {Set<string>} */
const boxSellInFlight = new Set();
/** @type {Set<string>} */
const boxNotifyInFlight = new Set();

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
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} lastPrice
 * @param {boolean} live — armed 실매매
 */
export async function processBoxFsmForProgram(program, box, lastPrice, live) {
  if (box.state === "closed" || box.tradeEligible === false) return;
  const sym = box.symbol;
  const market = boxMarketForProgram(program, box);
  const sim = program.status === "sim";
  const now = Date.now();

  if (!live && !sim) return;

  const rightMs = Number(box.rightTime) > 0 ? Number(box.rightTime) * 1000 : 0;
  const afterBox = rightMs > 0 && now > rightMs;

  if (box.state === "idle") {
    if (afterBox && lastPrice < box.bottom) {
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
    if (afterBox && broke && lastPrice >= box.mid) {
      if (!box.midNotifiedAtMs) {
        const notifyKey = `${program.id}:${box.boxId}`;
        if (!boxNotifyInFlight.has(notifyKey)) {
          boxNotifyInFlight.add(notifyKey);
          try {
            const sent = await notifyBoxRangeMidEntry(box, program, lastPrice, market);
            if (sent) {
              patchBoxSync(box.boxId, { midNotifiedAtMs: now });
            }
          } finally {
            boxNotifyInFlight.delete(notifyKey);
          }
        }
      }

      const openLots = countOpenBoxLotsSync(program.id);
      if (openLots >= program.maxOpenPositions) return;

      const dedupe = boxRangeBuyDedupeKey(program.id, box.boxId, sym);
      if (boxBuyInFlight.has(dedupe)) return;
      boxBuyInFlight.add(dedupe);

      let runErr = null;
      try {
        const pick = {
          symbol: sym,
          market,
          price: box.mid,
          name: sym,
          score: 1,
          signalIds: [`box-range:${box.timeframe}`],
        };
        const boxMeta = { boxId: box.boxId, boxTimeframe: box.timeframe };
        const targets = {
          targetSellPrice: box.top,
          stopLossPrice: box.bottom,
          exitScenarioNote: `box:${box.boxId}`,
          entryKind: `box:${box.timeframe}`,
          entryStructureNote: "박스권",
        };

        if (live && isProgramArmedForMarket(program, market)) {
          const userId = String(program.userId ?? "").trim();
          let trade = null;
          if (market === "crypto") {
            const out = await executeBithumbLiveBuyOrder(program, pick, {
              credentials: getDecryptedCredentialsSync(userId, "bithumb"),
            });
            if (!out.ok) throw new Error(out.error ?? "매수 실패");
            trade = await recordLiveTradeBuyAsync(
              program,
              { ...pick, price: out.fillPrice ?? box.mid },
              {
                simulated: out.simulated,
                orderId: out.orderId,
                fillVolume: out.fillVolume ?? undefined,
                ...boxMeta,
                targetSellPrice: box.top,
                stopLossPrice: box.bottom,
              },
            );
          } else {
            const out = await executeLiveBuyOrder(program, pick, { userId });
            if (!out.ok) throw new Error(out.error ?? "매수 실패");
            const orderAmount = await resolveOrderAmountForMarket(program, market);
            trade = recordLiveTradeBuySync(
              program,
              { ...pick, price: out.fillPrice ?? box.mid },
              {
                simulated: out.simulated,
                orderId: out.orderId,
                ...boxMeta,
              },
              targets,
              orderAmount,
            );
          }
          if (trade) {
            patchBoxSync(box.boxId, {
              state: "in_position",
              buyTradeId: trade.id,
              lotQty: trade.quantity,
              entryPrice: trade.price,
              buyAtMs: trade.atMs,
            });
            liveTradeLogInfo(
              "[box-range:buy]",
              program.name,
              sym,
              box.timeframe,
              trade.quantity,
            );
          }
        } else if (!live && program.simAutoBuy !== false) {
          const trade = await recordLiveTradeBuyAsync(
            program,
            pick,
            { simulated: true, ...boxMeta, targetSellPrice: box.top, stopLossPrice: box.bottom },
          );
          if (trade) {
            patchBoxSync(box.boxId, {
              state: "in_position",
              buyTradeId: trade.id,
              lotQty: trade.quantity,
              entryPrice: trade.price,
              buyAtMs: trade.atMs,
            });
            liveTradeLogInfo(
              "[box-range:sim-buy]",
              program.name,
              sym,
              box.timeframe,
            );
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

  if (box.state === "in_position") {
    const sellKey = `${program.id}:${box.boxId}`;
    if (boxSellInFlight.has(sellKey)) return;

    const lot = resolveBoxSellQuantitySync(box);
    if (lot.closed) {
      closeTradingBox(box, "reconciled");
      return;
    }
    const qty = lot.quantity;
    if (qty <= 0) return;
    const entry = lot.entryPrice ?? box.entryPrice ?? box.mid;
    let exitSide = null;
    let fillPrice = lastPrice;
    let soldQty = qty;
    if (lastPrice >= box.top) {
      exitSide = "tp";
      fillPrice = box.top;
    } else if (lastPrice <= box.bottom) {
      exitSide = "sl";
      fillPrice = box.bottom;
    }
    if (!exitSide) return;

    boxSellInFlight.add(sellKey);
    try {
      const userId = String(program.userId ?? "").trim();
      if (live && isProgramArmedForMarket(program, market)) {
        let simulated = false;
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
          fillPrice = out.fillPrice ?? fillPrice;
          simulated = Boolean(out.simulated);
          if (Number(out.fillVolume) > 0) soldQty = Number(out.fillVolume);
        } else {
          const out = await executeLiveSellOrder(
            program,
            { symbol: sym, market, quantity: qty, price: fillPrice },
            { userId },
          );
          if (!out.ok) throw new Error(out.error ?? "매도 실패");
          fillPrice = out.fillPrice ?? fillPrice;
          simulated = Boolean(out.simulated);
        }
        recordLiveTradeSellSync(
          {
            programId: program.id,
            symbol: sym,
            market,
            quantity: soldQty,
            price: fillPrice,
            note: `box:${box.boxId}:${exitSide}`,
            simulated,
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
            market,
            quantity: qty,
            price: fillPrice,
            note: `box:${box.boxId}:${exitSide}`,
            simulated: true,
            boxId: box.boxId,
            boxTimeframe: box.timeframe,
            entryPrice: entry,
          },
          userId,
        );
      }
      closeTradingBox(box, exitSide);
      liveTradeLogInfo(
        "[box-range:sell]",
        program.name,
        sym,
        exitSide,
        box.timeframe,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      liveTradeLogWarn("[box-range:sell]", program.name, sym, msg);
      touchLiveTradeProgramRunSync(program.id, msg);
    } finally {
      boxSellInFlight.delete(sellKey);
    }
  }
}
