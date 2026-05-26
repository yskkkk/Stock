/** @typedef {"kr" | "us" | "crypto"} Market */

import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";

const OPEN_STATES = new Set(["REGULAR"]);

/** KR: 장전 시간외 08:30–09:00 · 정규 09:00–15:30 · 시간외 15:30–18:00 (KST, 영업일) */
const KR_TRADABLE_START = 8 * 60 + 30;
const KR_TRADABLE_END = 18 * 60;

/** US: 프리 04:00–09:30 · 정규 09:30–16:00 · 애프터 16:00–20:00 (ET, 평일) */
const US_TRADABLE_START = 4 * 60;
const US_TRADABLE_END = 20 * 60;

/**
 * @param {Market} market
 * @param {Date} [now]
 */
function localMinutesOfDay(market, now = new Date()) {
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

/**
 * Yahoo chart meta.marketState 기준 (정규장만 개장으로 봄)
 * @param {string | undefined} marketState
 */
export function isRegularSession(marketState) {
  if (!marketState) return null;
  return OPEN_STATES.has(String(marketState).toUpperCase());
}

/**
 * @param {Market} market
 */
export function isMarketOpenBySchedule(market, now = new Date()) {
  if (market === "crypto") return true;
  const { weekday, minutes: mins } = localMinutesOfDay(market, now);
  if (weekday === "Sat" || weekday === "Sun") return false;

  if (market === "kr") {
    return mins >= 9 * 60 && mins < 15 * 60 + 30;
  }
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * 주식 매매 가능 시간(정규 + 장전·장후 시간외). UI 스캔 범위 강조용.
 * @param {Market} market
 * @param {Date} [now]
 */
export function isStockTradableBySchedule(market, now = new Date()) {
  if (market === "crypto") return true;

  if (market === "kr") {
    const kst = getKstParts(now);
    if (!isKrBusinessDay(kst.dateKey)) return false;
    return (
      kst.minutesOfDay >= KR_TRADABLE_START &&
      kst.minutesOfDay < KR_TRADABLE_END
    );
  }

  const { weekday, minutes: mins } = localMinutesOfDay("us", now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= US_TRADABLE_START && mins < US_TRADABLE_END;
}

/**
 * @param {Market} market
 * @param {string | undefined} marketState
 */
export function isMarketOpen(market, marketState) {
  if (market === "crypto") return true;
  const fromYahoo = isRegularSession(marketState);
  if (fromYahoo === true) return true;
  if (fromYahoo === false) return false;
  return isMarketOpenBySchedule(market);
}

/** 시장 현지 달력일 — 알림 발송 이력(세션) 구분용 */
export function getTradingSessionKey(market) {
  const tz =
    market === "crypto"
      ? "UTC"
      : market === "kr"
        ? "Asia/Seoul"
        : "America/New_York";
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `${market}:${date}`;
}
