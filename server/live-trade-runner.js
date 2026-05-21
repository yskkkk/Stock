/**
 * 무장(armed)된 실매매 프로그램 — 스크리너 고득점 픽에 대해 토스 주문 파이프라인 호출
 */
import {
  listArmedLiveTradeProgramsSync,
  touchLiveTradeProgramRunSync,
} from "./live-trade-programs-store.js";
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
 * @param {object} pick — screener pick (techModelId, score, market, symbol, …)
 */
export async function onHighScorePickForLiveTrading(pick) {
  const modelId = String(pick.techModelId ?? "").trim();
  if (!modelId) return;

  const programs = listArmedLiveTradeProgramsSync().filter((p) => p.modelId === modelId);
  if (!programs.length) return;

  const market = pick.market === "us" ? "us" : "kr";

  for (const program of programs) {
    if (market === "kr" && !program.markets.kr) continue;
    if (market === "us" && !program.markets.us) continue;
    if (!pickMeetsProgramThreshold(program, pick)) continue;

    const sym = String(pick.symbol ?? "").trim();
    if (!sym || shouldSkipDuplicate(program.id, sym)) continue;

    const out = await executeLiveBuyOrder(program, pick);
    touchLiveTradeProgramRunSync(
      program.id,
      out.ok ? null : (out.error ?? "주문 실패"),
    );
    if (out.ok) {
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
  }
}
