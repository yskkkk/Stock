/**
 * 실매매·시뮬 — 스크리너/텔레그램 알림 고득점 픽
 * 매수 트리거 SSOT: telegram-notify.notifyHighScorePick (screener는 여기만 호출)
 */
import fs from "node:fs";
import { dataFilePath } from "./store-json.js";
import {
  listArmedLiveTradeProgramsSync,
  listSimActiveProgramsSync,
  touchLiveTradeProgramRunSync,
} from "./live-trade-programs-store.js";
import { recordLiveTradeBuyAsync } from "./live-trade-portfolio-store.js";
import { resolveLiveTradeQuote } from "./live-trade-quote.js";
import { isProgramArmedForMarket } from "./live-trade-arm-gate.js";
import { normalizeLiveTradeMarket, programAllowsMarket } from "./live-trade-market.js";
import { executeBithumbLiveBuyOrder } from "./bithumb-trading-adapter.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import {
  executeLiveBuyOrder,
  pickMeetsProgramThreshold,
} from "./toss-trading-adapter.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import {
  clearLiveBuyInFlight,
  releaseLiveBuyReservation,
  tryAcquireLiveBuySlot,
} from "./live-trade-buy-guard.js";

const ORPHAN_LOG_FILE = dataFilePath("live-trade-orphan-orders.ndjson");

function logOrphanOrder(orderId, symbol, programId) {
  try {
    const entry = JSON.stringify({ orderId, symbol, programId, atMs: Date.now() });
    fs.appendFileSync(ORPHAN_LOG_FILE, entry + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 */
async function simBuyForProgram(program, pick) {
  const market = normalizeLiveTradeMarket(pick.market, pick.symbol);
  if (!programAllowsMarket(program, market)) return;
  if (!pickMeetsProgramThreshold(program, pick)) return;
  if (program.simAutoBuy === false) return;

  const sym = String(pick.symbol ?? "").trim();
  if (!sym) return;

  const slot = tryAcquireLiveBuySlot(program.id, program, sym, market, {
    liveOnly: false,
  });
  if (!slot.ok) return;

  let runErr = null;
  try {
    const quote = await resolveLiveTradeQuote(sym);
    await recordLiveTradeBuyAsync(
      program,
      {
        ...pick,
        symbol: sym,
        price: quote.price,
        name: pick.name ?? sym,
      },
      { simulated: true, atMs: quote.atMs },
    );
    liveTradeLogInfo(
      "[live-trade:sim]",
      program.name,
      sym,
      quote.price,
      pick.score,
    );
  } catch (e) {
    runErr = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[live-trade:sim]", program.name, sym, runErr);
    releaseLiveBuyReservation(slot.key);
  } finally {
    clearLiveBuyInFlight(slot.key);
  }
  touchLiveTradeProgramRunSync(program.id, runErr);
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 */
async function liveBuyForProgram(program, pick) {
  const market = normalizeLiveTradeMarket(pick.market, pick.symbol);
  if (!programAllowsMarket(program, market)) return;
  if (!isProgramArmedForMarket(program, market)) return;
  if (!pickMeetsProgramThreshold(program, pick)) return;

  const sym = String(pick.symbol ?? "").trim();
  if (!sym) return;

  const scope = `live:${program.id}`;
  const slot = tryAcquireLiveBuySlot(scope, program, sym, market, { liveOnly: true });
  if (!slot.ok) {
    if (slot.reason && slot.reason !== "dedupe" && slot.reason !== "in_flight") {
      liveTradeLogInfo(
        "[live-trade:skip]",
        program.name,
        sym,
        slot.reason,
      );
    }
    return;
  }

  const userId = String(program.userId ?? "").trim();
  if (!userId) {
    releaseLiveBuyReservation(slot.key);
    clearLiveBuyInFlight(slot.key);
    touchLiveTradeProgramRunSync(program.id, "프로그램 소유자가 없습니다.");
    return;
  }

  let runErr = null;
  try {
    const out =
      market === "crypto"
        ? await executeBithumbLiveBuyOrder(program, pick, {
            credentials: getDecryptedCredentialsSync(userId, "bithumb"),
          })
        : await executeLiveBuyOrder(program, pick);

    if (!out.ok) {
      runErr = out.error ?? "주문 실패";
      liveTradeLogWarn("[live-trade]", program.name, sym, runErr);
      releaseLiveBuyReservation(slot.key);
      return;
    }

    try {
      const quote = await resolveLiveTradeQuote(sym);
      const priceForRecord = out.fillPrice ?? quote.price;
      await recordLiveTradeBuyAsync(
        program,
        { ...pick, symbol: sym, price: priceForRecord },
        {
          simulated: out.simulated,
          orderId: out.orderId,
          atMs: quote.atMs,
          fillVolume: out.fillVolume ?? undefined,
          executedFunds: out.executedFunds ?? undefined,
        },
      );
    } catch (e) {
      runErr = e instanceof Error ? e.message : String(e);
      liveTradeLogWarn("[live-trade] portfolio record:", runErr);
      logOrphanOrder(out.orderId ?? null, sym, program.id);
    }
    liveTradeLogInfo(
      "[live-trade]",
      program.name,
      out.simulated ? "(simulated)" : "",
      sym,
      pick.score,
    );
  } catch (e) {
    runErr = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[live-trade]", program.name, sym, runErr);
    releaseLiveBuyReservation(slot.key);
  } finally {
    clearLiveBuyInFlight(slot.key);
  }
  touchLiveTradeProgramRunSync(program.id, runErr);
}

/**
 * @param {object} pick — screener pick (techModelId, score, market, symbol, …)
 */
export async function onHighScorePickForLiveTrading(pick) {
  const modelId = String(pick.techModelId ?? "").trim();
  if (!modelId) return;

  const simPrograms = listSimActiveProgramsSync().filter(
    (p) => p.modelId === modelId,
  );
  for (const program of simPrograms) {
    await simBuyForProgram(program, pick);
  }

  const livePrograms = listArmedLiveTradeProgramsSync().filter(
    (p) => p.modelId === modelId,
  );
  for (const program of livePrograms) {
    await liveBuyForProgram(program, pick);
  }
}
