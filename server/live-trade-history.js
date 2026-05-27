import {
  enrichPortfolioTradeNames,
  listLiveTradeRecordsSync,
} from "./live-trade-portfolio-store.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import { getCredentialMetaSync } from "./user-credentials-store.js";

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

/** @type {readonly ("sim"|"live-bithumb"|"live-toss")[]} */
export const TRADE_HISTORY_SCENARIOS = ["sim", "live-bithumb", "live-toss"];

/**
 * @param {{ scenario?: string; exchange?: string }} opts
 * @returns {"sim"|"live-bithumb"|"live-toss"|null}
 */
export function resolveTradeHistoryScenario(opts = {}) {
  const raw = String(opts.scenario ?? "").trim().toLowerCase();
  if (TRADE_HISTORY_SCENARIOS.includes(/** @type {typeof TRADE_HISTORY_SCENARIOS[number]} */ (raw))) {
    return /** @type {"sim"|"live-bithumb"|"live-toss"} */ (raw);
  }
  const ex = String(opts.exchange ?? "").trim().toLowerCase();
  if (ex === "bithumb") return "live-bithumb";
  if (ex === "toss") return "live-toss";
  return null;
}

/**
 * @param {object[]} trades
 * @param {"sim"|"live-bithumb"|"live-toss"|null} scenario
 */
export function filterTradesByScenario(trades, scenario) {
  if (!scenario) return trades;
  if (scenario === "sim") {
    return trades.filter((t) => t.simulated === true);
  }
  if (scenario === "live-bithumb") {
    return trades.filter((t) => !t.simulated && t.market === "crypto");
  }
  if (scenario === "live-toss") {
    return trades.filter(
      (t) => !t.simulated && (t.market === "kr" || t.market === "us"),
    );
  }
  return trades;
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
 * 빗썸 API 체결 우선 — 앱 기록은 orderId 일치 시 메타(진입가·프로그램명)만 보강
 * @param {object[]} apiTrades
 * @param {object[]} storeTrades
 */
function enrichBithumbApiHistoryTrades(apiTrades, storeTrades) {
  const byOrder = new Map();
  for (const t of storeTrades) {
    const oid = String(t.orderId ?? "").trim();
    if (oid) byOrder.set(oid, t);
  }
  return apiTrades.map((t) => {
    const s = byOrder.get(String(t.orderId ?? "").trim());
    if (!s) return t;
    return {
      ...t,
      entryPrice:
        t.entryPrice != null && Number.isFinite(t.entryPrice)
          ? t.entryPrice
          : s.entryPrice ?? null,
      programId: s.programId || t.programId,
      programName: s.programName || t.programName,
    };
  });
}

/**
 * 빗썸 API 체결은 최근 구간만 내려올 수 있어, 스토어에만 있는 과거 체결도 합친다.
 * orderId 기준으로 중복 제거.
 */
function mergeBithumbApiAndStoreTrades(apiTrades, storeTrades) {
  const apiByOrder = new Set(
    apiTrades
      .map((t) => String(t.orderId ?? "").trim())
      .filter(Boolean),
  );
  const storeOnly = storeTrades.filter((t) => {
    const oid = String(t.orderId ?? "").trim();
    if (!oid) return true;
    return !apiByOrder.has(oid);
  });
  return [...apiTrades, ...storeOnly].sort((a, b) => b.atMs - a.atMs);
}

/** API 미연동 시 빈 실매매 이력(앱·시뮬 기록 노출 방지) */
function emptyLiveTradeHistoryPayload(scenario) {
  const day = kstDateKeyFromMs(Date.now());
  return {
    trades: [],
    rangeStartDay: day,
    rangeEndDay: day,
    hasOlder: false,
    nextOlderEndDay: null,
    fetchedAtMs: Date.now(),
    scenario,
    apiNotConnected: true,
  };
}

function historyRangeFromTrades(trades) {
  const rangeEndDay =
    trades.length > 0
      ? kstDateKeyFromMs(trades[0].atMs)
      : kstDateKeyFromMs(Date.now());
  const rangeStartDay =
    trades.length > 0
      ? kstDateKeyFromMs(trades[trades.length - 1].atMs)
      : rangeEndDay;
  return { rangeStartDay, rangeEndDay };
}

/**
 * @param {string} userId
 * @param {{ endDay?: string, days?: number, all?: boolean, programId?: string, exchange?: "bithumb"|"toss", scenario?: "sim"|"live-bithumb"|"live-toss" }} [opts]
 */
export async function buildLiveTradeHistoryPayloadAsync(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("userId required");

  const scenario = resolveTradeHistoryScenario(opts);
  const programId = String(opts.programId ?? "").trim();

  if (scenario === "sim") {
    let records = listLiveTradeRecordsSync(null, uid);
    if (programId) records = records.filter((t) => t.programId === programId);
    records = records.filter((t) => t.simulated === true);
    let trades = [...records].sort((a, b) => b.atMs - a.atMs);
    trades = enrichPortfolioTradeNames(trades);
    trades = attachProgramNames(trades, uid);
    const { rangeStartDay, rangeEndDay } = historyRangeFromTrades(trades);
    return {
      trades,
      rangeStartDay,
      rangeEndDay,
      hasOlder: false,
      nextOlderEndDay: null,
      fetchedAtMs: Date.now(),
      scenario,
    };
  }

  if (scenario === "live-bithumb") {
    if (!getCredentialMetaSync(uid, "bithumb")?.ready) {
      return emptyLiveTradeHistoryPayload("live-bithumb");
    }
    const { listBithumbTradesFromExchangeApiForHistory } = await import(
      "./live-trade-bithumb-exchange-trades.js"
    );
    let apiTrades = [];
    try {
      apiTrades = await listBithumbTradesFromExchangeApiForHistory(uid);
    } catch {
      apiTrades = [];
    }
    let storeCrypto = filterTradesByExchange(
      listLiveTradeRecordsSync(null, uid),
      "bithumb",
    );
    storeCrypto = storeCrypto.filter((t) => !t.simulated);
    if (programId) storeCrypto = storeCrypto.filter((t) => t.programId === programId);
    /** 실매매만 — 빗썸 API 체결 + 스토어 과거 체결 합치기 */
    let trades =
      apiTrades.length > 0
        ? mergeBithumbApiAndStoreTrades(
            enrichBithumbApiHistoryTrades(apiTrades, storeCrypto),
            storeCrypto,
          )
        : storeCrypto;
    trades = enrichPortfolioTradeNames(trades);
    trades = attachProgramNames(trades, uid);
    const { rangeStartDay, rangeEndDay } = historyRangeFromTrades(trades);
    return {
      trades,
      rangeStartDay,
      rangeEndDay,
      hasOlder: false,
      nextOlderEndDay: null,
      fetchedAtMs: Date.now(),
      scenario,
    };
  }

  const payload = buildLiveTradeHistoryPayload(userId, opts);

  if (scenario === "live-toss") {
    if (!getCredentialMetaSync(uid, "toss")?.ready) {
      return emptyLiveTradeHistoryPayload("live-toss");
    }
    const filtered = filterTradesByScenario(payload.trades, "live-toss");
    return {
      ...payload,
      trades: filtered,
      fetchedAtMs: Date.now(),
      scenario,
    };
  }

  return payload;
}
