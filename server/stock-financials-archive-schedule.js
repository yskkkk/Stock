/**
 * 재무제표 일일 아카이브 — 정규장 시작 10분 전 (KR 08:50 KST · US 09:20 ET)
 */
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { getTradingSessionKey } from "./market-hours.js";

/** KR 정규 09:00 → 10분 전 */
export const KR_FINANCIALS_ARCHIVE_MIN = 8 * 60 + 50;
/** US 정규 09:30 → 10분 전 */
export const US_FINANCIALS_ARCHIVE_MIN = 9 * 60 + 20;

/** 장 시작 후에도 서버 재기동 시 당일 1회 보충 실행 허용(분) */
const CATCH_UP_AFTER_OPEN_MIN = 120;

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
function localMarketClock(market, now = new Date()) {
  const tz = market === "kr" ? "Asia/Seoul" : "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey,
  };
}

export function financialsArchiveEnabled() {
  const v = String(process.env.STOCK_FINANCIALS_ARCHIVE ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function isFinancialsArchiveTradingDay(market, now = new Date()) {
  if (market === "kr") {
    const kst = getKstParts(now);
    return isKrBusinessDay(kst.dateKey);
  }
  const { weekday } = localMarketClock("us", now);
  return weekday !== "Sat" && weekday !== "Sun";
}

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function financialsArchiveTargetMinutes(market) {
  return market === "kr" ? KR_FINANCIALS_ARCHIVE_MIN : US_FINANCIALS_ARCHIVE_MIN;
}

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function financialsArchiveOpenMinutes(market) {
  return market === "kr" ? 9 * 60 : 9 * 60 + 30;
}

/**
 * 당일 아카이브 실행 윈도우(목표 시각 ~ 장 시작 후 catch-up)
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function isFinancialsArchiveRunWindow(market, now = new Date()) {
  if (!isFinancialsArchiveTradingDay(market, now)) return false;
  const { minutes } = localMarketClock(market, now);
  const target = financialsArchiveTargetMinutes(market);
  const open = financialsArchiveOpenMinutes(market);
  const end = open + CATCH_UP_AFTER_OPEN_MIN;
  return minutes >= target && minutes < end;
}

/**
 * @param {"kr"|"us"} market
 * @param {string | null | undefined} lastSessionKey
 * @param {Date} [now]
 */
export function shouldRunFinancialsArchive(market, lastSessionKey, now = new Date()) {
  if (!financialsArchiveEnabled()) return false;
  if (!isFinancialsArchiveRunWindow(market, now)) return false;
  const sessionKey = getTradingSessionKey(market, now);
  return lastSessionKey !== sessionKey;
}
