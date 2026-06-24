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
import { boxRangeDetectEnabled, boxRangeCryptoScanEnabled } from "./box-range/constants.js";
import { startLiveTradeExchangeSyncPoller } from "./live-trade-exchange-sync.js";
import { startBithumbLedgerPoller } from "./live-trade-bithumb-ledger.js";
import { startTossLedgerSnapshotPoller } from "./live-trade-toss-ledger.js";
import { startOpsFileDevPoller } from "./ops-file-dev-poller.js";
import { startServerSelfImprovementWatcher } from "./server-self-improvement-log.js";
import { prewarmAppCaches } from "./prewarm-caches.js";
import { startGoldenCrossScanPoller } from "./golden-cross-poller.js";
import { startBottomCandleScanPoller } from "./bottom-candle-poller.js";
import { startKrInvestorFlowPoller } from "./kr-investor-flow-poller.js";
import { startFinancialsArchivePoller } from "./stock-financials-archive-poller.js";
import { startStockShareStructurePoller } from "./stock-share-structure-poller.js";
import { startMaAlignMa120WatchPoller } from "./ma-align-ma120-watch.js";
import { startHoldingsNewsEmailPoller } from "./holdings-news-poller.js";
import { screeningPollerEnabled, startScreening } from "./screener.js";
import { registerPollerLazyStarter } from "./poller-registry.js";

function registerDevSidecarPollers() {
  registerPollerLazyStarter("dev-queue-sync", startDevQueueDisplaySyncPoller);
  registerPollerLazyStarter("ide-transcript", startOpsIdeTranscriptPoller);
  registerPollerLazyStarter("live-trade-exchange-sync", startLiveTradeExchangeSyncPoller);
  registerPollerLazyStarter("toss-ledger-cache", startTossLedgerSnapshotPoller);
  registerPollerLazyStarter("toss-ledger-api", startTossLedgerSnapshotPoller);
  registerPollerLazyStarter("live-trade-auto-sell", startLiveTradeAutoSellPoller);
  registerPollerLazyStarter("box-range-runner", startBoxRangeRunnerPoller);
  registerPollerLazyStarter("box-sp500-scan", startSp500BoxRangeCatalogPoller);
  registerPollerLazyStarter("box-kr-scan", startKrBoxRangeCatalogPoller);
  registerPollerLazyStarter("box-crypto-scan", startCryptoBoxRangeCatalogPoller);
  registerPollerLazyStarter("ops-file-dev", startOpsFileDevPoller);
  registerPollerLazyStarter("golden-cross", startGoldenCrossScanPoller);
  registerPollerLazyStarter("golden-cross-intraday", startGoldenCrossScanPoller);
  registerPollerLazyStarter("bottom-candle", startBottomCandleScanPoller);
  registerPollerLazyStarter("kr-investor-flow", startKrInvestorFlowPoller);
  registerPollerLazyStarter("financials-archive", startFinancialsArchivePoller);
  registerPollerLazyStarter("share-structure", startStockShareStructurePoller);
  registerPollerLazyStarter("ma120-near-watch", startMaAlignMa120WatchPoller);
  registerPollerLazyStarter("holdings-news", startHoldingsNewsEmailPoller);
  registerPollerLazyStarter("self-improvement", startServerSelfImprovementWatcher);
  registerPollerLazyStarter("screener", () => {
    if (screeningPollerEnabled()) {
      startScreening().catch(logScreeningError);
    }
  });
}

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
  registerDevSidecarPollers();
  if (modeLabel) {
    appendServerEventLog("server", `${modeLabel} — 로그는 server/.logs 에 append 유지`);
  }
  startDevQueueDisplaySyncPoller();
  startOpsIdeTranscriptPoller();
  startLiveTradeExchangeSyncPoller();
  startBithumbLedgerPoller();
  startTossLedgerSnapshotPoller();
  startLiveTradeAutoSellPoller();
  purgeBoxRangeCryptoOutsideHtfSymbolsSync();
  startBoxRangeRunnerPoller();
  if (boxRangeDetectEnabled()) {
    startSp500BoxRangeCatalogPoller();
    startKrBoxRangeCatalogPoller();
    if (boxRangeCryptoScanEnabled()) {
      startCryptoBoxRangeCatalogPoller();
    }
  } else {
    appendServerEventLog("server", "box-range detect off (STOCK_BOX_RANGE_DETECT≠1)");
  }
  startOpsFileDevPoller();
  startGoldenCrossScanPoller();
  startKrInvestorFlowPoller();
  startFinancialsArchivePoller();
  startStockShareStructurePoller();
  startMaAlignMa120WatchPoller();
  startHoldingsNewsEmailPoller();
  startServerSelfImprovementWatcher();
  setTimeout(() => prewarmAppCaches(), 400);
  setTimeout(() => {
    if (screeningPollerEnabled()) {
      startScreening().catch(logScreeningError);
    }
  }, 1500);
}
