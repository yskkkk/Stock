/**
 * 실매매·시뮬 — 스크리너/텔레그램 알림 고득점 픽
 */
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

/** programId:symbol -> atMs */
const recentOrderKeys = new Map();
const DEDUPE_MS = 6 * 60 * 60 * 1000;

function orderDedupeKey(programId, symbol) {
  return `${programId}:${String(symbol ?? "").trim().toUpperCase()}`;
}

function shouldSkipDuplicate(programId, symbol) {
  const key = orderDedupeKey(programId, symbol);
  const prev = recentOrderKeys.get(key);
  if (prev && Date.now() - prev < DEDUPE_MS) return true;
  recentOrderKeys.set(key, Date.now());
  if (recentOrderKeys.size > 800) {
    const cutoff = Date.now() - DEDUPE_MS;
    for (const [k, t] of recentOrderKeys) {
      if (t < cutoff) recentOrderKeys.delete(k);
    }
  }
  return false;
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
  if (!sym || shouldSkipDuplicate(program.id, sym)) return;

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
    console.info(
      "[live-trade:sim]",
      program.name,
      sym,
      quote.price,
      pick.score,
    );
  } catch (e) {
    runErr = e instanceof Error ? e.message : String(e);
    console.warn("[live-trade:sim]", program.name, sym, runErr);
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
  if (!sym || shouldSkipDuplicate(`live:${program.id}`, sym)) return;

  const userId = String(program.userId ?? "").trim();
  if (!userId) {
    touchLiveTradeProgramRunSync(program.id, "프로그램 소유자가 없습니다.");
    return;
  }
  const out =
    market === "crypto"
      ? await executeBithumbLiveBuyOrder(program, pick, {
          credentials: getDecryptedCredentialsSync(userId, "bithumb"),
        })
      : await executeLiveBuyOrder(program, pick);
  let runErr = out.ok ? null : (out.error ?? "주문 실패");
  if (out.ok) {
    try {
      const quote = await resolveLiveTradeQuote(sym);
      await recordLiveTradeBuyAsync(
        program,
        { ...pick, symbol: sym, price: quote.price },
        {
          simulated: out.simulated,
          orderId: out.orderId,
          atMs: quote.atMs,
        },
      );
    } catch (e) {
      runErr = e instanceof Error ? e.message : String(e);
      console.warn("[live-trade] portfolio record:", runErr);
    }
    console.info(
      "[live-trade]",
      program.name,
      out.simulated ? "(simulated)" : "",
      sym,
      pick.score,
    );
  } else {
    console.warn("[live-trade]", program.name, sym, out.error);
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
