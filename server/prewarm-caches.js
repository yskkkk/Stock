import { prewarmMacroEventsCache } from "./macro-events.js";
import { prewarmSectorEarningsCache } from "./sector-earnings-spotlight.js";

/** API 첫 요청 지연 줄이기 — macro·섹터 실적 백그라운드 선로드 */
export function prewarmAppCaches() {
  prewarmMacroEventsCache();
  prewarmSectorEarningsCache();
}
