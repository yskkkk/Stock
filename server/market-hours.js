/** @typedef {"kr" | "us"} Market */

const OPEN_STATES = new Set(["REGULAR"]);

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
export function isMarketOpenBySchedule(market) {
  const tz = market === "kr" ? "Asia/Seoul" : "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );

  const wd = parts.weekday;
  if (wd === "Sat" || wd === "Sun") return false;

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const mins = hour * 60 + minute;

  if (market === "kr") {
    return mins >= 9 * 60 && mins < 15 * 60 + 30;
  }
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * @param {Market} market
 * @param {string | undefined} marketState
 */
export function isMarketOpen(market, marketState) {
  const fromYahoo = isRegularSession(marketState);
  if (fromYahoo === true) return true;
  if (fromYahoo === false) return false;
  return isMarketOpenBySchedule(market);
}

/** 시장 현지 달력일 — 알림 발송 이력(세션) 구분용 */
export function getTradingSessionKey(market) {
  const tz = market === "kr" ? "Asia/Seoul" : "America/New_York";
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `${market}:${date}`;
}
