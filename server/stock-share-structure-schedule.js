/**
 * 주식 수량 유니버스 스캔 — 정규장 마감 직후 (KR 15:30 KST · US 16:00 ET)
 */
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { getTradingSessionKey } from "./market-hours.js";

/** KR 정규장 마감 15:30 */
export const KR_SHARE_STRUCTURE_CLOSE_MIN = 15 * 60 + 30;
/** US 정규장 마감 16:00 */
export const US_SHARE_STRUCTURE_CLOSE_MIN = 16 * 60;

/** 마감 후 서버 재기동 시 당일 1회 보충 실행 허용(분) */
const CATCH_UP_AFTER_CLOSE_MIN = 120;

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
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function shareStructureScanEnabled() {
  const v = String(process.env.STOCK_SHARE_STRUCTURE_SCAN ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function isShareStructureTradingDay(market, now = new Date()) {
  if (market === "kr") {
    const kst = getKstParts(now);
    return isKrBusinessDay(kst.dateKey);
  }
  const { weekday } = localMarketClock("us", now);
  return weekday !== "Sat" && weekday !== "Sun";
}

/**
 * @param {"kr"|"us"} market
 */
export function shareStructureCloseMinutes(market) {
  return market === "kr" ? KR_SHARE_STRUCTURE_CLOSE_MIN : US_SHARE_STRUCTURE_CLOSE_MIN;
}

/**
 * 마감 시각 ~ 마감 후 catch-up 윈도우
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function isShareStructureRunWindow(market, now = new Date()) {
  if (!isShareStructureTradingDay(market, now)) return false;
  const { minutes } = localMarketClock(market, now);
  const close = shareStructureCloseMinutes(market);
  const end = close + CATCH_UP_AFTER_CLOSE_MIN;
  return minutes >= close && minutes < end;
}

/**
 * @param {"kr"|"us"} market
 * @param {string | null | undefined} lastSessionKey
 * @param {Date} [now]
 */
export function shouldRunShareStructureScan(market, lastSessionKey, now = new Date()) {
  if (!shareStructureScanEnabled()) return false;
  if (!isShareStructureRunWindow(market, now)) return false;
  const sessionKey = getTradingSessionKey(market, now);
  return lastSessionKey !== sessionKey;
}
