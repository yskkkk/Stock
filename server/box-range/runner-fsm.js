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
import { BOX_RANGE_CONFIRM_MIN_MS } from "./constants.js";
import { boxRangeBuyDedupeKey } from "./buy-guard.js";
import { resolveBoxSellQuantitySync } from "./lot-reconcile.js";
import { markCatalogBoxConsumedSync } from "./catalog-store.js";
import { notifyBoxRangeDipRecoveryEntry } from "./box-range-telegram.js";

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
    breakAtMs: null,
    dipLow: null,
    confirmingAtMs: null,
  });
  const cid = String(box.catalogBoxId ?? "").trim();
  if (cid) markCatalogBoxConsumedSync(cid, reason);
}

/** Pine PRO v2: 익절 후 triggered/dipLow 리셋 — 동일 박스 재진입 허용 */
function resetBoxAfterTakeProfit(box) {
  patchBoxSync(box.boxId, {
    state: "idle",
    lotQty: 0,
    buyTradeId: null,
    entryPrice: null,
    buyAtMs: null,
    breakAtMs: null,
    dipLow: null,
    armedAtMs: null,
    midNotifiedAtMs: null,
    confirmingAtMs: null,
  });
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
  if (box.dead === true) {
    // 손절 후 박스 소멸 — 재진입 금지
    closeTradingBox(box, "dead");
    return;
  }

  const rightMs = Number(box.rightTime) > 0 ? Number(box.rightTime) * 1000 : 0;
  const afterBox = rightMs > 0 && now > rightMs;

  if (box.state === "idle") {
    // 트리거: 박스 종료 후 하단 이하 이탈 (종가 대신 lastPrice 사용)
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
    const broke = box.breakAtMs != null;
    if (!afterBox || !broke) return;

    // 이탈 구간 최저점 갱신(손절 기준) — Pine: trig 중 low 최저
    const nextDip =
      box.dipLow == null || lastPrice < box.dipLow ? lastPrice : box.dipLow;
    if (nextDip !== box.dipLow) patchBoxSync(box.boxId, { dipLow: nextDip });

    // 하단 복귀 첫 틱 → confirming 상태로 전환 (확인캔들 모델 ⑩)
    if (lastPrice >= box.bottom) {
      patchBoxSync(box.boxId, { state: "confirming", confirmingAtMs: now });
    }
    return;
  }

  if (box.state === "confirming") {
    const broke = box.breakAtMs != null;
    if (!afterBox || !broke) return;

    // 가짜 복귀: 다시 하단 아래로 → armed로 복귀
    if (lastPrice < box.bottom) {
      const nextDip =
        box.dipLow == null || lastPrice < box.dipLow ? lastPrice : box.dipLow;
      patchBoxSync(box.boxId, { state: "armed", dipLow: nextDip, confirmingAtMs: null });
      return;
    }

    // TF 1봉 미만 경과 → 아직 확인 대기 중
    const minConfirmMs = BOX_RANGE_CONFIRM_MIN_MS[box.timeframe] ?? 3_600_000;
    if (now - (box.confirmingAtMs ?? now) < minConfirmMs) return;

    // 복귀 확인 완료 → 포지션 한도 먼저 확인 후 알림 + 매수
    const openLots = countOpenBoxLotsSync(program.id);
    if (openLots >= program.maxOpenPositions) return;

    if (!box.midNotifiedAtMs) {
      const notifyKey = `${program.id}:${box.boxId}`;
      if (!boxNotifyInFlight.has(notifyKey)) {
        boxNotifyInFlight.add(notifyKey);
        try {
          const sent = await notifyBoxRangeDipRecoveryEntry(
            { ...box },
            program,
            lastPrice,
            market,
          );
          if (sent) {
            patchBoxSync(box.boxId, { midNotifiedAtMs: now });
          }
        } finally {
          boxNotifyInFlight.delete(notifyKey);
        }
      }
    }

    const dedupe = boxRangeBuyDedupeKey(program.id, box.boxId, sym);
    if (boxBuyInFlight.has(dedupe)) return;
    boxBuyInFlight.add(dedupe);

    // 손절가 = 박스 하단 (Pine 동일): 매수는 하단 위 현재가, 손절은 하단 아래 재이탈 시
    // dipLow(최저점)는 0거리 손절 유발 — box.bottom이 항상 매수가보다 낮음
    const stopLoss = box.bottom;
    let runErr = null;
    try {
      const pick = {
        symbol: sym,
        market,
        price: box.bottom,
        name: sym,
        score: 1,
        signalIds: [`box-range:${box.timeframe}`],
      };
      const boxMeta = { boxId: box.boxId, boxTimeframe: box.timeframe };
      const targets = {
        targetSellPrice: box.top,
        stopLossPrice: stopLoss,
        exitScenarioNote: `box:${box.boxId}`,
        entryKind: `box:${box.timeframe}`,
        entryStructureNote: "박스권",
      };

      if (live && isProgramArmedForMarket(program, market)) {
        const userId = String(program.userId ?? "").trim();
        let trade = null;
        let liveFillPrice = box.bottom;
        if (market === "crypto") {
          const out = await executeBithumbLiveBuyOrder(program, pick, {
            credentials: getDecryptedCredentialsSync(userId, "bithumb"),
          });
          if (!out.ok) throw new Error(out.error ?? "매수 실패");
          liveFillPrice = out.fillPrice ?? box.bottom;
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
          liveFillPrice = out.fillPrice ?? box.bottom;
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
            targets,
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
            dipLow: stopLoss,
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
          { simulated: true, ...boxMeta, targetSellPrice: box.top, stopLossPrice: stopLoss },
        );
        if (trade) {
          patchBoxSync(box.boxId, {
            state: "in_position",
            buyTradeId: trade.id,
            lotQty: trade.quantity,
            entryPrice: box.bottom,
            buyAtMs: trade.atMs,
            dipLow: stopLoss,
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
    const entry = lot.entryPrice ?? box.entryPrice ?? box.bottom;
    let exitSide = null;
    let fillPrice = lastPrice;
    let soldQty = qty;
    if (lastPrice >= box.top) {
      exitSide = "tp";
      fillPrice = box.top;
    } else if (lastPrice < box.bottom) {
      // 손절: 박스 하단 아래로 재이탈 — Pine 동일 (low <= bottom)
      // dipLow 기준은 매수가 ≈ dipLow인 경우 0거리 손절 유발
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
        // 매도 API 성공 직후 state 업데이트 — 이후 기록 실패해도 중복 매도 방지
        if (exitSide === "tp") {
          resetBoxAfterTakeProfit(box);
        } else {
          patchBoxSync(box.boxId, { dead: true });
          closeTradingBox(box, exitSide);
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
        if (exitSide === "tp") {
          resetBoxAfterTakeProfit(box);
        } else {
          patchBoxSync(box.boxId, { dead: true });
          closeTradingBox(box, exitSide);
        }
      }
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
