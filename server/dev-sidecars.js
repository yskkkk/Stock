/**
 * Vite dev·preview·`server/index.js` 공통 — 폴러·스크리너는 프로세스당 1회만 기동.
 */
import { appendServerEventLog } from "./access-log.js";
import { startDevQueueDisplaySyncPoller } from "./ops-dev-queue-display-sync.js";
import { startOpsIdeTranscriptPoller } from "./ops-ide-transcript-poller.js";
import { startLiveTradeAutoSellPoller } from "./live-trade-auto-sell.js";
import { startBoxRangeRunnerPoller } from "./box-range/runner.js";
import { startSp500BoxRangeCatalogPoller } from "./box-range/sp500-scan-runner.js";
import { startKrBoxRangeCatalogPoller } from "./box-range/kr-scan-runner.js";
import { startCryptoBoxRangeCatalogPoller } from "./box-range/crypto-scan-runner.js";
import { purgeBoxRangeCryptoOutsideHtfSymbolsSync } from "./box-range/crypto-htf-purge.js";
import { startLiveTradeExchangeSyncPoller } from "./live-trade-exchange-sync.js";
import { startBithumbLedgerPoller } from "./live-trade-bithumb-ledger.js";
import { startOpsFileDevPoller } from "./ops-file-dev-poller.js";
import { startServerSelfImprovementWatcher } from "./server-self-improvement-log.js";
import { prewarmAppCaches } from "./prewarm-caches.js";
import { startScreening, screeningPollerEnabled } from "./screener.js";

function logScreeningError(err) {
  console.warn("[screener]", err instanceof Error ? err.message : err);
}

/** @param {string} [modeLabel] */
export function startStockDevSidecarsOnce(modeLabel) {
  const g = /** @type {typeof globalThis & { __stockViteDevSidecars?: boolean }} */ (
    globalThis
  );
  if (g.__stockViteDevSidecars) return;
  g.__stockViteDevSidecars = true;
  if (modeLabel) {
    appendServerEventLog("server", `${modeLabel} — 로그는 server/.logs 에 append 유지`);
  }
  startDevQueueDisplaySyncPoller();
  startOpsIdeTranscriptPoller();
  startLiveTradeExchangeSyncPoller();
  startBithumbLedgerPoller();
  startLiveTradeAutoSellPoller();
  purgeBoxRangeCryptoOutsideHtfSymbolsSync();
  startBoxRangeRunnerPoller();
  startSp500BoxRangeCatalogPoller();
  startKrBoxRangeCatalogPoller();
  startCryptoBoxRangeCatalogPoller();
  startOpsFileDevPoller();
  startServerSelfImprovementWatcher();
  setTimeout(() => prewarmAppCaches(), 400);
  setTimeout(() => {
    if (screeningPollerEnabled()) {
      startScreening().catch(logScreeningError);
    }
  }, 1500);
}
