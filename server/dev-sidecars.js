/**
 * Vite dev·preview·`server/index.js` 공통 — 폴러는 프로세스당 1회만 기동.
 */
import { appendServerEventLog } from "./access-log.js";
import { startDevQueueDisplaySyncPoller } from "./ops-dev-queue-display-sync.js";
import { startOpsIdeTranscriptPoller } from "./ops-ide-transcript-poller.js";
import { startLiveTradeAutoSellPoller } from "./live-trade-auto-sell.js";
import { startBoxRangeRunnerPoller } from "./box-range/runner.js";
import { startSp500BoxRangeCatalogPoller } from "./box-range/sp500-scan-runner.js";
import { startKrBoxRangeCatalogPoller } from "./box-range/kr-scan-runner.js";
import { purgeBoxRangeCryptoOutsideHtfSymbolsSync } from "./box-range/crypto-htf-purge.js";
import { boxRangeDetectEnabled } from "./box-range/constants.js";
import { startLiveTradeExchangeSyncPoller } from "./live-trade-exchange-sync.js";
import { startBithumbLedgerPoller } from "./live-trade-bithumb-ledger.js";
import { startTossLedgerSnapshotPoller } from "./live-trade-toss-ledger.js";
import { startOpsFileDevPoller } from "./ops-file-dev-poller.js";
import { startServerSelfImprovementWatcher } from "./server-self-improvement-log.js";
import { prewarmAppCaches } from "./prewarm-caches.js";
import { startGoldenCrossScanPoller } from "./golden-cross-poller.js";
import { startBottomCandleScanPoller } from "./bottom-candle-poller.js";
import { startGranvilleScanPoller } from "./granville-poller.js";
import { startScanCoverageLedgerPoller } from "./scan-coverage-poller.js";
import { startKrInvestorFlowPoller } from "./kr-investor-flow-poller.js";
import { startFinancialsArchivePoller } from "./stock-financials-archive-poller.js";
import { startStockShareStructurePoller } from "./stock-share-structure-poller.js";
import { startMaAlignMa120WatchPoller } from "./ma-align-ma120-watch.js";
import { startHoldingsNewsEmailPoller } from "./holdings-news-poller.js";
import { startHoldingsCloseDigestPoller } from "./holdings-close-digest-poller.js";
import { startUsAnnouncementInboxPoller } from "./us-announcement-poller.js";
import { startTossRebalanceSchedulePoller } from "./toss-rebalance-schedule-poller.js";
import { startVirtualUserContinuousPoller } from "./virtual-user-poller.js";
import { startOpsRecordModePoller } from "./ops-record-mode-poller.js";
import { ensureBaselineCodeVersionSync } from "./code-version-store.js";
import { migrateBaselineToPreVirtualUserSync } from "./code-version-store.js";
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
  registerPollerLazyStarter("ops-file-dev", startOpsFileDevPoller);
  registerPollerLazyStarter("golden-cross", startGoldenCrossScanPoller);
  registerPollerLazyStarter("golden-cross-intraday", startGoldenCrossScanPoller);
  registerPollerLazyStarter("bottom-candle", startBottomCandleScanPoller);
  registerPollerLazyStarter("granville", startGranvilleScanPoller);
  registerPollerLazyStarter("scan-coverage", startScanCoverageLedgerPoller);
  registerPollerLazyStarter("kr-investor-flow", startKrInvestorFlowPoller);
  registerPollerLazyStarter("financials-archive", startFinancialsArchivePoller);
  registerPollerLazyStarter("share-structure", startStockShareStructurePoller);
  registerPollerLazyStarter("ma120-near-watch", startMaAlignMa120WatchPoller);
  registerPollerLazyStarter("holdings-news", startHoldingsNewsEmailPoller);
  registerPollerLazyStarter("holdings-close-digest", startHoldingsCloseDigestPoller);
  registerPollerLazyStarter("us-announcement-inbox", startUsAnnouncementInboxPoller);
  registerPollerLazyStarter("toss-rebalance-schedule", startTossRebalanceSchedulePoller);
  registerPollerLazyStarter("virtual-user-continuous", startVirtualUserContinuousPoller);
  registerPollerLazyStarter("ops-record-mode", startOpsRecordModePoller);
  registerPollerLazyStarter("self-improvement", startServerSelfImprovementWatcher);
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
  } else {
    appendServerEventLog("server", "box-range detect off (STOCK_BOX_RANGE_DETECT≠1)");
  }
  startOpsFileDevPoller();
  startGoldenCrossScanPoller();
  startBottomCandleScanPoller();
  startGranvilleScanPoller();
  startScanCoverageLedgerPoller();
  startKrInvestorFlowPoller();
  startFinancialsArchivePoller();
  startStockShareStructurePoller();
  startMaAlignMa120WatchPoller();
  startHoldingsNewsEmailPoller();
  startHoldingsCloseDigestPoller();
  startUsAnnouncementInboxPoller();
  startTossRebalanceSchedulePoller();
  startVirtualUserContinuousPoller();
  try {
    migrateBaselineToPreVirtualUserSync();
    ensureBaselineCodeVersionSync();
  } catch {
    /* baseline optional at boot — 재기동으로 baseline을 새로 잡지 않음 */
  }
  startOpsRecordModePoller();
  startServerSelfImprovementWatcher();
  // 지수·지표·실적은 페이지와 동시에 쓰이므로 즉시 프리웜(나머지 무거운 것도 포함)
  prewarmAppCaches();
}
