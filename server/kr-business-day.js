import { KR_PUBLIC_HOLIDAYS } from "./kr-holidays.js";

const KST = "Asia/Seoul";

/**
 * @param {Date} [d]
 */
export function getKstParts(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: KST,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * @param {string} dateKey YYYY-MM-DD
 */
export function isKrWeekend(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * @param {string} dateKey
 */
export function isKrPublicHoliday(dateKey) {
  return KR_PUBLIC_HOLIDAYS.has(dateKey);
}

/**
 * @param {string} dateKey
 */
export function isKrBusinessDay(dateKey) {
  if (isKrWeekend(dateKey)) return false;
  if (isKrPublicHoliday(dateKey)) return false;
  return true;
}

/**
 * @param {string} dateKey
 * @param {number} deltaDays
 */
export function shiftDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12, 0, 0) + deltaDays * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * @param {string} dateKey
 */
export function previousKrBusinessDay(dateKey) {
  let cur = shiftDateKey(dateKey, -1);
  for (let i = 0; i < 14; i++) {
    if (isKrBusinessDay(cur)) return cur;
    cur = shiftDateKey(cur, -1);
  }
  return cur;
}

/**
 * 원화 환산에 쓸 기준일 — 당일 09:00 KST 환율이 확정된 가장 최근 영업일
 * @param {Date} [now]
 */
export function resolveFxValuationDateKst(now = new Date()) {
  const kst = getKstParts(now);
  let dateKey = kst.dateKey;

  if (!isKrBusinessDay(dateKey)) {
    return previousKrBusinessDay(dateKey);
  }
  if (kst.minutesOfDay < 9 * 60) {
    return previousKrBusinessDay(dateKey);
  }
  return dateKey;
}

/**
 * KST dateKey 의 09:00 → UTC epoch sec (KST=UTC+9)
 * @param {string} dateKey
 */
export function kst9amUtcSec(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000);
}

/**
 * @param {string} dateKey
 */
export function kst9amUtcWindow(dateKey) {
  const targetSec = kst9amUtcSec(dateKey);
  return {
    targetSec,
    period1: targetSec - 45 * 60,
    period2: targetSec + 3 * 60 * 60,
  };
}
