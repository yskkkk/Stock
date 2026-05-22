/**
 * 주식 추천 텔레그램 1건 — 스크리너/API에서 상위 1종목 또는 인자 심볼
 *   node scripts/send-one-stock-pick-telegram.mjs
 *   node scripts/send-one-stock-pick-telegram.mjs 005930.KS
 */
import { loadEnvFile } from "../server/load-env.js";
import { fetchScanCandles } from "../server/stock-data.js";
import { resolveDisplayName } from "../server/names-ko.js";
import { getActiveTechModelsSync } from "../server/picks-tech-models-store.js";
import { analyzeTechnicals } from "../server/technical.js";
import { sendStockPickTelegramNow } from "../server/telegram-notify.js";

loadEnvFile();

/** @param {string} symbol @param {"kr"|"us"} market */
async function screenOneSymbol(symbol, market) {
  const data = await fetchScanCandles(symbol);
  const models = getActiveTechModelsSync();
  /** @type {object | null} */
  let best = null;
  for (const model of models) {
    const analysis = analyzeTechnicals(data.candles, model.weights);
    const pick = {
      symbol: data.symbol,
      name: resolveDisplayName(data.symbol, symbol, data.quote?.name),
      market,
      price: data.quote?.price,
      change: data.quote?.change,
      changePercent: data.quote?.changePercent,
      currency: data.quote?.currency,
      dayHigh: data.quote?.dayHigh,
      dayLow: data.quote?.dayLow,
      turnover: data.quote?.turnover,
      score: analysis.score,
      signalIds: analysis.signalIds,
      signals: analysis.signals,
      marketState: data.quote?.marketState,
      techModelId: model.id,
      techModelName: model.name,
      techModelWeights: model.weights,
    };
    if (!best || pick.score > best.score) best = pick;
  }
  return best;
}

const symbolArg = process.argv[2]?.trim();

/** @param {unknown} j */
function picksFromApiJson(j) {
  const kr = Array.isArray(j?.kr) ? j.kr : [];
  const us = Array.isArray(j?.us) ? j.us : [];
  return [...kr, ...us].filter((p) => p?.symbol && p?.name);
}

async function fetchTopPick() {
  const bases = [
    process.env.STOCK_API_BASE ?? "",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3456",
  ].filter(Boolean);
  const seen = new Set();
  for (const base of bases) {
    if (seen.has(base)) continue;
    seen.add(base);
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/api/picks`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) continue;
      const list = picksFromApiJson(await r.json());
      if (!list.length) continue;
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return list[0];
    } catch {
      /* next */
    }
  }
  return null;
}

/** @param {string} sym */
function pickBySymbol(sym) {
  const all = picksFromApiJson(
    globalThis.__picksJson ?? { kr: [], us: [] },
  );
  const u = sym.toUpperCase();
  return all.find((p) => String(p.symbol).toUpperCase() === u) ?? null;
}

let pick = null;
if (symbolArg) {
  const bases = ["http://127.0.0.1:5173", "http://127.0.0.1:3456"];
  for (const base of bases) {
    try {
      const r = await fetch(`${base}/api/picks`);
      if (r.ok) {
        globalThis.__picksJson = await r.json();
        pick = pickBySymbol(symbolArg);
        if (pick) break;
      }
    } catch {
      /* ignore */
    }
  }
} else {
  pick = await fetchTopPick();
}

if (!pick) {
  const fallback = symbolArg || "005930.KS";
  const market = /\.KS$|\.KQ$/i.test(fallback) ? "kr" : "us";
  console.log(`API 목록 없음 — ${fallback} 단일 스캔 후 전송 시도…`);
  try {
    pick = await screenOneSymbol(fallback, market);
  } catch (e) {
    console.error(
      "추천 종목을 가져오지 못했습니다:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
  }
}

if (!pick) {
  console.error("스캔 결과가 없습니다.");
  process.exit(1);
}

const ok = await sendStockPickTelegramNow(pick, {
  bypassDedup: true,
  bypassScore: true,
  recordSent: false,
});

if (!ok) {
  console.error("전송 실패 — TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID·서버 로그 확인");
  process.exit(1);
}

console.log(
  `전송 완료: ${pick.name} (${pick.symbol}) score=${pick.score ?? "?"}`,
);
