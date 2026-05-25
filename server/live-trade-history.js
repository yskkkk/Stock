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
 * @param {string} userId
 * @param {{ endDay?: string, days?: number }} [opts]
 */
export function buildLiveTradeHistoryPayload(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("userId required");

  const endDay =
    String(opts.endDay ?? "").trim() || kstDateKeyFromMs(Date.now());
  const days = Math.max(
    1,
    Math.min(31, Math.floor(Number(opts.days) || 1)),
  );
  const startDay = shiftKstDateKey(endDay, -(days - 1));
  const startMs = dayStartMsKst(startDay);
  const endMs = dayEndMsKst(endDay);

  const all = listLiveTradeRecordsSync(null, uid);
  let trades = all.filter((t) => t.atMs >= startMs && t.atMs <= endMs);
  trades.sort((a, b) => b.atMs - a.atMs);
  trades = enrichPortfolioTradeNames(trades);

  const programs = listLiveTradeProgramsSync(uid);
  const nameById = new Map(programs.map((p) => [p.id, p.name]));
  trades = trades.map((t) => ({
    ...t,
    programName: nameById.get(t.programId) ?? t.programId,
  }));

  const hasOlder = all.some((t) => t.atMs < startMs);
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
