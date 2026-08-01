import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { ensureKrSearchIndex } from "./kr-stock-search-index.js";
import { warmUniverseCache } from "./universe.js";
import { prewarmMacroEventsCache } from "./macro-events.js";
import { prewarmMarketIndicesCache } from "./market-indices.js";
import { buildRecommendationsTrackerPayload } from "./picks-recommendations-tracker.js";
import { prewarmSectorEarningsCache } from "./sector-earnings-spotlight.js";
import { probeOpsTelegramSetup, probeStockTelegramSetup } from "./telegram-notify.js";

function probeTelegramOnce() {
  const g = /** @type {typeof globalThis & { __stockTelegramProbed?: boolean }} */ (
    globalThis
  );
  if (g.__stockTelegramProbed) return;
  g.__stockTelegramProbed = true;
  void probeStockTelegramSetup().catch((e) => {
    console.warn("[prewarm] telegram stock probe:", e instanceof Error ? e.message : e);
  });
  void probeOpsTelegramSetup().catch((e) => {
    console.warn("[prewarm] telegram ops probe:", e instanceof Error ? e.message : e);
  });
}

/** API 첫 요청 지연 줄이기 — 주요 탭 데이터 백그라운드 선로드 */
export function prewarmAppCaches() {
  // 셸 첫 페인트: 지수·지표·실적 즉시(2.5s 지연은 클라와 레이스)
  prewarmMarketIndicesCache();
  prewarmMacroEventsCache();
  prewarmSectorEarningsCache();
  probeTelegramOnce();
  void buildRecommendationsTrackerPayload({ includeQuotes: false }).catch((e) => {
    console.warn("[prewarm] recommendations-tracker:", e instanceof Error ? e.message : e);
  });
  void loadCryptoWatchlistTen().catch((e) => {
    console.warn("[prewarm] crypto-universe:", e instanceof Error ? e.message : e);
  });
  void warmUniverseCache();
  void ensureKrSearchIndex().catch((e) => {
    console.warn("[prewarm] kr-search-index:", e instanceof Error ? e.message : e);
  });
}
