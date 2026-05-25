/**
 * 실매매·시뮬 매수 중복 방지 — 스크리너 이중 호출·동시 틱·재알림
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLiveTradeMarket } from "./live-trade-market.js";
import {
  buildPositionsFromTrades,
  readStoreSync,
} from "./live-trade-portfolio-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEDUP_FILE = path.join(__dirname, ".data", "live-trade-dedup.json");
export const LIVE_TRADE_BUY_DEDUPE_MS = 6 * 60 * 60 * 1000;

/** @type {Set<string>} */
const inFlightKeys = new Set();

function loadDedupState() {
  try {
    if (!fs.existsSync(DEDUP_FILE)) return new Map();
    const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf8"));
    const cutoff = Date.now() - LIVE_TRADE_BUY_DEDUPE_MS;
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
  } catch {
    /* ignore */
  }
}

const recentOrderKeys = loadDedupState();

export function orderDedupeKey(scope, symbol) {
  return `${scope}:${String(symbol ?? "").trim().toUpperCase()}`;
}

function isDedupeKeyActive(key) {
  const prev = recentOrderKeys.get(key);
  return Boolean(prev && Date.now() - prev < LIVE_TRADE_BUY_DEDUPE_MS);
}

/**
 * @param {string} programId
 * @param {string} symbol
 * @param {"kr"|"us"|"crypto"} market
 * @param {{ withinMs?: number; liveOnly?: boolean }} [opts]
 */
export function programBlocksDuplicateBuySync(
  programId,
  symbol,
  market,
  opts = {},
) {
  const pid = String(programId ?? "").trim();
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!pid || !sym) return { blocked: false };
  const mk = normalizeLiveTradeMarket(market, sym);
  const withinMs = opts.withinMs ?? LIVE_TRADE_BUY_DEDUPE_MS;
  const liveOnly = opts.liveOnly !== false;
  const cutoff = Date.now() - withinMs;

  const store = readStoreSync();
  const { positions } = buildPositionsFromTrades(store.trades, pid);
  if (
    positions.some(
      (p) =>
        String(p.symbol).toUpperCase() === sym &&
        p.market === mk &&
        Number(p.quantity) > 0,
    )
  ) {
    return { blocked: true, reason: "open_position" };
  }

  const recentBuy = store.trades.some((t) => {
    if (t.programId !== pid || t.side !== "buy") return false;
    if (String(t.symbol).toUpperCase() !== sym || t.market !== mk) return false;
    if (liveOnly && t.simulated) return false;
    return typeof t.atMs === "number" && t.atMs >= cutoff;
  });
  if (recentBuy) return { blocked: true, reason: "recent_buy" };
  return { blocked: false };
}

/**
 * 주문 전 슬롯 확보(파일 dedup + in-flight + 포트폴리오).
 * @param {string} scope — 예: program.id 또는 `live:${program.id}`
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {string} symbol
 * @param {{ liveOnly?: boolean }} [opts]
 * @returns {{ ok: boolean; key?: string; reason?: string }}
 */
export function tryAcquireLiveBuySlot(scope, program, symbol, market, opts = {}) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return { ok: false, reason: "no_symbol" };
  const key = orderDedupeKey(scope, sym);
  if (inFlightKeys.has(key)) return { ok: false, reason: "in_flight" };
  if (isDedupeKeyActive(key)) return { ok: false, reason: "dedupe" };

  const mk = normalizeLiveTradeMarket(market, sym);
  const block = programBlocksDuplicateBuySync(program.id, sym, mk, {
    liveOnly: opts.liveOnly,
  });
  if (block.blocked) return { ok: false, reason: block.reason };

  inFlightKeys.add(key);
  recentOrderKeys.set(key, Date.now());
  if (recentOrderKeys.size > 800) {
    const cutoff = Date.now() - LIVE_TRADE_BUY_DEDUPE_MS;
    for (const [k, t] of recentOrderKeys) {
      if (t < cutoff) recentOrderKeys.delete(k);
    }
  }
  saveDedupState(recentOrderKeys);
  return { ok: true, key };
}

/** @param {string} key */
export function releaseLiveBuySlot(key) {
  if (!key) return;
  inFlightKeys.delete(key);
  recentOrderKeys.delete(key);
  saveDedupState(recentOrderKeys);
}

/** @param {string} key — 주문 실패 시 예약만 해제(in-flight·dedup 키) */
export function releaseLiveBuyReservation(key) {
  if (!key) return;
  inFlightKeys.delete(key);
  recentOrderKeys.delete(key);
  saveDedupState(recentOrderKeys);
}

/** 성공 후 in-flight만 해제(dedup 키는 유지) */
export function clearLiveBuyInFlight(key) {
  if (!key) return;
  inFlightKeys.delete(key);
}
