/**
 * 실매매·시뮬 — 스크리너/텔레그램 알림 고득점 픽
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEDUP_FILE = path.join(__dirname, ".data", "live-trade-dedup.json");
const ORPHAN_LOG_FILE = path.join(__dirname, ".data", "live-trade-orphan-orders.ndjson");

const DEDUPE_MS = 6 * 60 * 60 * 1000;

function loadDedupState() {
  try {
    if (!fs.existsSync(DEDUP_FILE)) return new Map();
    const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf8"));
    const cutoff = Date.now() - DEDUPE_MS;
    const map = new Map();
    for (const [k, t] of Object.entries(data)) {
      if (typeof t === "number" && t >= cutoff) map.set(k, t);
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveDedupState(map) {
  try {
    const dir = path.dirname(DEDUP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${DEDUP_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)), "utf8");
    fs.renameSync(tmp, DEDUP_FILE);
  } catch {}
}

/** programId:symbol -> atMs */
const recentOrderKeys = loadDedupState();

function orderDedupeKey(programId, symbol) {
  return `${programId}:${String(symbol ?? "").trim().toUpperCase()}`;
}

function isDuplicate(programId, symbol) {
  const key = orderDedupeKey(programId, symbol);
  const prev = recentOrderKeys.get(key);
  return Boolean(prev && Date.now() - prev < DEDUPE_MS);
}

function markDedupKey(programId, symbol) {
  const key = orderDedupeKey(programId, symbol);
  recentOrderKeys.set(key, Date.now());
  if (recentOrderKeys.size > 800) {
    const cutoff = Date.now() - DEDUPE_MS;
    for (const [k, t] of recentOrderKeys) {
      if (t < cutoff) recentOrderKeys.delete(k);
    }
  }
  saveDedupState(recentOrderKeys);
}

function logOrphanOrder(orderId, symbol, programId) {
  try {
    const entry = JSON.stringify({ orderId, symbol, programId, atMs: Date.now() });
    fs.appendFileSync(ORPHAN_LOG_FILE, entry + "\n", "utf8");
  } catch {}
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
  if (!sym || isDuplicate(program.id, sym)) return;

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
    markDedupKey(program.id, sym);
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
  if (!sym || isDuplicate(`live:${program.id}`, sym)) return;

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
      const priceForRecord = out.fillPrice ?? quote.price;
      await recordLiveTradeBuyAsync(
        program,
        { ...pick, symbol: sym, price: priceForRecord },
        {
          simulated: out.simulated,
          orderId: out.orderId,
          atMs: quote.atMs,
        },
      );
      markDedupKey(`live:${program.id}`, sym);
    } catch (e) {
      runErr = e instanceof Error ? e.message : String(e);
      liveTradeLogWarn("[live-trade] portfolio record:", runErr);
      logOrphanOrder(out.orderId ?? null, sym, program.id);
      // 포트폴리오 기록 실패해도 dedup 등록 — 재시도 주문 방지
      markDedupKey(`live:${program.id}`, sym);
    }
    liveTradeLogInfo(
      "[live-trade]",
      program.name,
      out.simulated ? "(simulated)" : "",
      sym,
      pick.score,
    );
  } else {
    liveTradeLogWarn("[live-trade]", program.name, sym, out.error);
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
