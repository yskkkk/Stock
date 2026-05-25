import {
  enrichPortfolioTradeNames,
  listLiveTradeRecordsSync,
} from "./live-trade-portfolio-store.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";

/** @param {number} ms */
export function kstDateKeyFromMs(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** @param {string} dateKey YYYY-MM-DD @param {number} deltaDays */
export function shiftKstDateKey(dateKey, deltaDays) {
  const base = new Date(`${dateKey}T12:00:00+09:00`).getTime();
  return kstDateKeyFromMs(base + deltaDays * 86_400_000);
}

/** @param {string} dateKey */
function dayStartMsKst(dateKey) {
  return new Date(`${dateKey}T00:00:00+09:00`).getTime();
}

/** @param {string} dateKey */
function dayEndMsKst(dateKey) {
  return new Date(`${dateKey}T23:59:59.999+09:00`).getTime();
}

/**
 * @param {LiveTradeRecord[]} trades
 * @param {string} userId
 */
function attachProgramNames(trades, userId) {
  const programs = listLiveTradeProgramsSync(userId);
  const nameById = new Map(programs.map((p) => [p.id, p.name]));
  return trades.map((t) => ({
    ...t,
    programName: nameById.get(t.programId) ?? t.programId,
  }));
}

/**
 * @param {string} userId
 * @param {{ endDay?: string, days?: number, all?: boolean, programId?: string }} [opts]
 */
export function buildLiveTradeHistoryPayload(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("userId required");

  const programId = String(opts.programId ?? "").trim();
  let allRecords = listLiveTradeRecordsSync(null, uid);
  if (programId) {
    allRecords = allRecords.filter((t) => t.programId === programId);
  }

  if (opts.all === true) {
    let trades = [...allRecords].sort((a, b) => b.atMs - a.atMs);
    trades = enrichPortfolioTradeNames(trades);
    trades = attachProgramNames(trades, uid);
    const rangeEndDay =
      trades.length > 0
        ? kstDateKeyFromMs(trades[0].atMs)
        : kstDateKeyFromMs(Date.now());
    const rangeStartDay =
      trades.length > 0
        ? kstDateKeyFromMs(trades[trades.length - 1].atMs)
        : rangeEndDay;
    return {
      trades,
      rangeStartDay,
      rangeEndDay,
      hasOlder: false,
      nextOlderEndDay: null,
      fetchedAtMs: Date.now(),
    };
  }

  const endDay =
    String(opts.endDay ?? "").trim() || kstDateKeyFromMs(Date.now());
  const days = Math.max(
    1,
    Math.min(31, Math.floor(Number(opts.days) || 1)),
  );
  const startDay = shiftKstDateKey(endDay, -(days - 1));
  const startMs = dayStartMsKst(startDay);
  const endMs = dayEndMsKst(endDay);

  let trades = allRecords.filter((t) => t.atMs >= startMs && t.atMs <= endMs);
  trades.sort((a, b) => b.atMs - a.atMs);
  trades = enrichPortfolioTradeNames(trades);
  trades = attachProgramNames(trades, uid);

  const hasOlder = allRecords.some((t) => t.atMs < startMs);
  const nextOlderEndDay = hasOlder ? shiftKstDateKey(startDay, -1) : null;

  return {
    trades,
    rangeStartDay: startDay,
    rangeEndDay: endDay,
    hasOlder,
    nextOlderEndDay,
    fetchedAtMs: Date.now(),
  };
}

/** @param {"bithumb"|"toss"} exchange @param {object[]} trades */
export function filterTradesByExchange(trades, exchange) {
  if (exchange === "bithumb") {
    return trades.filter((t) => t.market === "crypto");
  }
  if (exchange === "toss") {
    return trades.filter((t) => t.market === "kr" || t.market === "us");
  }
  return trades;
}

/**
 * @param {object[]} storeTrades
 * @param {object[]} apiTrades
 */
function mergeHistoryTrades(storeTrades, apiTrades) {
  /** @type {Map<string, object>} */
  const byKey = new Map();
  for (const t of storeTrades) {
    const k = String(t.orderId ?? "").trim() || String(t.id ?? "");
    if (k) byKey.set(k, t);
  }
  for (const t of apiTrades) {
    const k = String(t.orderId ?? "").trim() || String(t.id ?? "");
    if (!k || byKey.has(k)) continue;
    byKey.set(k, t);
  }
  return [...byKey.values()].sort((a, b) => b.atMs - a.atMs);
}

/**
 * @param {string} userId
 * @param {{ endDay?: string, days?: number, all?: boolean, programId?: string, exchange?: "bithumb"|"toss" }} [opts]
 */
export async function buildLiveTradeHistoryPayloadAsync(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("userId required");

  const exchange = opts.exchange;

  if (exchange === "bithumb") {
    try {
      const { syncLiveTradeExchangeForUser } = await import(
        "./live-trade-exchange-sync.js"
      );
      const programs = listLiveTradeProgramsSync(uid);
      await syncLiveTradeExchangeForUser(uid, programs);
    } catch {
      /* 동기화 실패해도 API 조회 시도 */
    }
  }

  const payload = buildLiveTradeHistoryPayload(userId, opts);

  if (exchange === "bithumb") {
    const { listBithumbTradesFromExchangeApiForHistory } = await import(
      "./live-trade-bithumb-exchange-trades.js"
    );
    let apiTrades = [];
    try {
      apiTrades = await listBithumbTradesFromExchangeApiForHistory(uid);
    } catch {
      apiTrades = [];
    }
    const storeCrypto = filterTradesByExchange(payload.trades, "bithumb");
    let merged =
      opts.all === true
        ? mergeHistoryTrades(storeCrypto, apiTrades)
        : mergeHistoryTrades(payload.trades, apiTrades);
    merged = enrichPortfolioTradeNames(merged);
    merged = attachProgramNames(merged, uid);
    merged = filterTradesByExchange(merged, "bithumb");
    return { ...payload, trades: merged, fetchedAtMs: Date.now() };
  }

  if (exchange === "toss") {
    const filtered = filterTradesByExchange(payload.trades, "toss");
    return { ...payload, trades: filtered, fetchedAtMs: Date.now() };
  }

  return payload;
}
