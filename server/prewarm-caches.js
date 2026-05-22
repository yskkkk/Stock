import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { prewarmMacroEventsCache } from "./macro-events.js";
import { buildRecommendationsTrackerPayload } from "./picks-recommendations-tracker.js";
import { prewarmSectorEarningsCache } from "./sector-earnings-spotlight.js";
import { probeTelegramSetup } from "./telegram-notify.js";

/** API 첫 요청 지연 줄이기 — 주요 탭 데이터 백그라운드 선로드 */
export function prewarmAppCaches() {
  prewarmMacroEventsCache();
  prewarmSectorEarningsCache();
  void probeTelegramSetup().then((r) => {
    if (r.ok) console.info("[telegram] bot ready", r.bot ? `@${r.bot}` : "");
  });
  void buildRecommendationsTrackerPayload({ includeQuotes: false }).catch((e) => {
    console.warn("[prewarm] recommendations-tracker:", e instanceof Error ? e.message : e);
  });
  void loadCryptoWatchlistTen().catch((e) => {
    console.warn("[prewarm] crypto-universe:", e instanceof Error ? e.message : e);
  });
}
