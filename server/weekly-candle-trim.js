import { candleTimeToDateKey } from "./golden-cross-detect.js";

/**
 * Yahoo 주봉은 미완성 이번 주 봉(일봉보다 최신 날짜)이 붙는 경우가 있어
 * MA 정배열·교차가 TradingView(완성 주봉 기준)와 어긋난다.
 *
 * @param {Array<{ time?: unknown }>} weeklyCandles
 * @param {Array<{ time?: unknown }>} [dailyCandles]
 */
export function trimPartialWeeklyCandle(weeklyCandles, dailyCandles) {
  if (!Array.isArray(weeklyCandles) || weeklyCandles.length < 2) {
    return Array.isArray(weeklyCandles) ? weeklyCandles : [];
  }
  const wLast = weeklyCandles.at(-1);
  const dLast = Array.isArray(dailyCandles) ? dailyCandles.at(-1) : null;
  const wKey = candleTimeToDateKey(wLast?.time);
  const dKey = candleTimeToDateKey(dLast?.time);
  if (wKey && dKey && wKey > dKey) {
    return weeklyCandles.slice(0, -1);
  }
  return weeklyCandles;
}

/**
 * 주봉 스캔·판정용 캔들 (미완성 주봉 제외)
 * @param {Array<{ time?: unknown }>} weeklyCandles
 * @param {Array<{ time?: unknown }>} [dailyCandles]
 */
export function candlesForWeeklyMaScan(weeklyCandles, dailyCandles) {
  return trimPartialWeeklyCandle(weeklyCandles, dailyCandles);
}
