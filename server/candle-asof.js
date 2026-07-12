/**
 * As-of(기준일) 캔들 절단 — 백필 스캔이 「그 날짜에 실제로 점검한 것처럼」
 * 해당 금융영업일까지의 캔들만 사용하도록 뒤쪽(미래) 봉을 잘라낸다.
 *
 * 각 스캔의 탐지 함수는 «마지막 봉»을 기준으로 판정하므로, asOf 날짜까지만 남기면
 * 마지막 봉 = asOf 세션이 되어 그 시점의 판정이 재현된다. (주봉은 봉 시각이 그 주의
 * 시작이므로 asOf가 속한 주까지 포함된다 — 정규장 마감 세션 백필에서는 그 주가 완료된다.)
 */

import { candleTimeToDateKey } from "./golden-cross-detect.js";

/** @param {string} dateKey */
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

/**
 * asOf(YYYY-MM-DD) 이후 봉을 제거. asOf가 없거나 잘못되면 원본 그대로 반환.
 * @template {{ time?: unknown }} C
 * @param {C[]} candles
 * @param {string|null|undefined} asOf
 * @returns {C[]}
 */
export function truncateCandlesAsOf(candles, asOf) {
  if (!Array.isArray(candles) || !isValidDateKey(asOf)) return candles;
  const out = [];
  for (const c of candles) {
    const dk = candleTimeToDateKey(c?.time);
    // dateKey를 못 구하면(형식 불명) 보수적으로 포함 — 대부분 정상 봉은 구해진다.
    if (dk == null || dk <= asOf) out.push(c);
  }
  return out;
}
