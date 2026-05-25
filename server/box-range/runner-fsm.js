import {
  touchLiveTradeProgramRunSync,
} from "../live-trade-programs-store.js";
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
import {
  countOpenBoxLotsSync,
  patchBoxSync,
} from "./store.js";
import { boxRangeBuyDedupeKey } from "./buy-guard.js";
import { resolveBoxSellQuantitySync } from "./lot-reconcile.js";

/** @type {Set<string>} */
const boxBuyInFlight = new Set();

/**
 * @param {import("../live-trade-programs-store.js").LiveTradeProgram} program
 * @param {import("./store.js").BoxRangeRecord} box
 * @param {number} lastPrice
 * @param {boolean} live
 */
export async function processBoxFsmForProgram(program, box, lastPrice, live) {
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
            { simulated: true, ...boxMeta },
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
    const lot = resolveBoxSellQuantitySync(box);
    if (lot.closed) {
      patchBoxSync(box.boxId, {
        state: "closed",
        lotQty: 0,
        buyTradeId: null,
        entryPrice: null,
        buyAtMs: null,
      });
      return;
    }
    const qty = lot.quantity;
    if (qty <= 0) return;
    const entry = lot.entryPrice ?? box.entryPrice ?? box.mid;
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
        buyAtMs: null,
      });
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
    }
  }
}
