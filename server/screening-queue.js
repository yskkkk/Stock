import { isMarketOpenBySchedule } from "./market-hours.js";

/** @typedef {{ kr: object[]; us: object[]; crypto?: object[] }} Universe */

/** UI용 전체 범위 문구(항상 두 구간 표시, 비활성은 클라이언트에서 투명 처리) */
export function scanScopeLabel() {
  return "국내 300 · S&P 500";
}

export function scanScopeMarketFlags() {
  return {
    krActive: isMarketOpenBySchedule("kr"),
    usActive: isMarketOpenBySchedule("us"),
  };
}

/**
 * 장 마감·휴장 시장은 스캔 큐에서 제외 (국내 정규장 외 KR 미포함).
 * @param {Universe} universe
 */
export function buildScreeningQueue(universe) {
  const includeKr = isMarketOpenBySchedule("kr");
  /** @type {{ symbol: string; name?: string; market: "kr" | "us" | "crypto" }[]} */
  const queue = [];
  if (includeKr) {
    for (const s of universe.kr) queue.push({ ...s, market: "kr" });
  }
  for (const s of universe.us) queue.push({ ...s, market: "us" });
  for (const s of universe.crypto ?? []) queue.push({ ...s, market: "crypto" });
  const { krActive, usActive } = scanScopeMarketFlags();
  return {
    queue,
    includeKr,
    includeUs: true,
    scanScopeKrActive: krActive,
    scanScopeUsActive: usActive,
    scanScopeLabel: scanScopeLabel(),
  };
}
