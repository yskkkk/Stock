import express from "express";
import { randomUUID } from "node:crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isAccessAdminIp,
  isAccessAdminRequest,
  normalizeAccessIp,
  registerAccessControl,
  verifyAccessAdminPassword,
} from "./access-control.js";
import { requireAccessAdmin } from "./route-guards.js";
import { registerUiFeatureToggleRoutes } from "./ui-feature-toggles.js";
import { appendServerEventLog, expressAccessLogger, clientIp as expressClientIp } from "./access-log.js";
import {
  fetchDartDisclosures,
  getDartStatus,
  isDartEnabled,
  searchDartCompanies,
  searchDartDisclosures,
} from "./dart.js";
import {
  ensureScreening,
  forceRescreen,
  getPicksState,
} from "./screener.js";
import {
  clearTodayTelegramSent,
  getTelegramNotifyStatus,
  isTelegramNotifyEnabled,
  listTodayTelegramSent,
} from "./telegram-notify.js";
import { loadNews } from "./news.js";
import { loadCryptoQuotes } from "./crypto-quotes.js";
import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { fetchScanCandles, loadStock } from "./stock-data.js";
import { loadBuffettIntrinsicValue } from "./buffett-intrinsic-input.js";
import { loadStockShareStructure } from "./stock-share-structure.js";
import { loadValueInvestReturn } from "./value-invest-return-input.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { loadFinancialStatementAnalysis } from "./stock-financials-analysis.js";
import { buildTechnicalStatusReport } from "./technical.js";
import { detectDailyMa5OverMa20 } from "./ma-align-detect.js";
import {
  getActiveTechModelsSync,
  getTechModelByIdSync,
} from "./picks-tech-models-store.js";
import { sumTechScoreWeights } from "./picks-tech-weights-store.js";
import { clearYahooSession } from "./yahoo.js";
import { getUsdKrwRate } from "./fx-usd-krw.js";
import { getMarketIndices } from "./market-indices.js";
import { searchCryptoForLiveTrade } from "./crypto-live-search.js";
import { searchStocks } from "./stock-search.js";
import { loadHotStocksByTurnover } from "./stock-search-hot.js";
import { notifyServerOpenRequest } from "./server-open-request-notify.js";
import { getMacroEventsCachedAsync } from "./macro-events.js";
import { fetchSectorEarningsSpotlight } from "./sector-earnings-spotlight.js";
import { postFeedback, getFeedbackInbox, postFeedbackAdminReply, deleteFeedbackAdmin } from "./feedback-inbox.js";
import { runOpsCursorAgent, streamOpsCursorAgentSse, writeOpsAgentSseEvent } from "./cursor-ops-agent.js";
import {
  abandonIdeDevQueueSlot,
  acquireIdeDevQueueSlot,
  enqueueOpsAgentJob,
  registerClaudeCodeQueueSlot,
  registerIdeDevQueueSlot,
  releaseAnyRunningIdeDevQueueSlot,
  releaseClaudeCodeQueueSlot,
  releaseIdeDevQueueSlot,
  waitIdeDevQueueGrant,
} from "./ops-agent-job-queue.js";
import { clearIdeLeaseOnDisk } from "./ops-ide-lease-disk.js";
import { restartNodeOrViteDev } from "./restart-node-process.js";
import { installMobileApkDownload } from "./mobile-apk-download.js";
import { installMobileIosDownload } from "./mobile-ios-download.js";
import {
  getServerRestartPasswordExpected,
  verifyServerRestartPassword,
} from "./server-restart-auth.js";
import { checkOpsInstructionPolicy } from "./ops-agent-instruction-policy.js";
import { getOpsAgentPendingForIp } from "./ops-agent-pending-store.js";
import {
  appendRecordModePendingJob,
  mergeRecordModeQueueFromClient,
  purgeRecordModeErrorItemsSync,
  readRecordModeActivityLogEntries,
  readRecordModeQueueSync,
  RECORD_MODE_POLL_MS,
} from "./ops-record-mode-store.js";
import {
  enrichPicksStateWithHistory,
  getPicksDailyHistoryForApi,
} from "./picks-history-store.js";
import {
  buildRecommendationsTrackerPayload,
  scheduleRecommendationSignalBackfill,
  scheduleRecommendationsTrackerSnapshotRefresh,
} from "./picks-recommendations-tracker.js";
import {
  decorateRecommendationsTrackerResponse,
  isRecommendationsTrackerSnapshotStale,
  readRecommendationsTrackerSnapshotSync,
} from "./picks-recommendations-tracker-snapshot.js";
import {
  applyTechWeights,
  getActiveSignalScoreWeightsSync,
  getDefaultSignalScoreWeights,
  getTechWeightsMetaSync,
  resetTechWeightsSync,
} from "./picks-tech-weights-store.js";
import {
  createTechModelSync,
  deleteTechModelSync,
  getMaxTechScoreSync,
  listTechModelsSync,
  listTechModelsForLiveTradingSync,
  resetDefaultTechModelWeightsSync,
  setActiveTechModelIdsSync,
  updateTechModelSync,
} from "./picks-tech-models-store.js";
import { validateLiveTradeArmLane } from "./live-trade-arm-gate.js";
import {
  armLiveTradeProgramLaneSync,
  createLiveTradeProgramSync,
  deleteLiveTradeProgramSync,
  disarmLiveTradeProgramSync,
  getLiveTradeProgramSync,
  healOwnerMissingProgramErrorsSync,
  healStuckSimProgramErrorsSync,
  listLiveTradeProgramsForUserSync,
  migrateProgramsForAccountOnceSync,
  StoreCorruptError,
  startSimLiveTradeProgramSync,
  stopSimLiveTradeProgramSync,
  updateLiveTradeProgramSync,
} from "./live-trade-programs-store.js";
import {
  ensureLiveTradeExitScenarioMigratedOnce,
  ensureLiveTradeSellSettingsMigratedOnce,
} from "./live-trade-settings-migrate.js";
import { buildLiveTradeHistoryPayload } from "./live-trade-history.js";
import {
  buildLiveTradePortfolioSnapshot,
  buildProgramPortfolioSummariesMap,
  enrichProgramReturnsFromHoldings,
  purgeLiveTradeRecordsForProgramSync,
  recordLiveTradeSimBuyAsync,
  recordLiveTradeSimSellAsync,
  recordLiveTradeSellSync,
} from "./live-trade-portfolio-store.js";
import { reconcileBithumbHoldingsForUser } from "./live-trade-bithumb-reconcile.js";
import {
  buildBithumbOpenOrdersForUser,
  cancelBithumbOpenOrderForUser,
} from "./live-trade-bithumb-open-orders.js";
import {
  buildTossOpenOrdersForUser,
  cancelTossOpenOrderForUser,
  placeTossOrderForUser,
} from "./live-trade-toss-orders.js";
import { fetchTossSellableQuantityForUser } from "./toss-trading-adapter.js";
import {
  buildTossHoldingReportForUser,
  buildTossHoldingsManageBoardForUser,
  executeTossHoldingPlanOrderForUser,
  saveTossHoldingPlanForUser,
} from "./toss-holdings-report.js";
import {
  analyzeSimProgramFeedback,
  applySimProgramFeedbackPatch,
  buildSimCreationRecommendations,
} from "./live-trade-sim-feedback.js";
import { getTossTradingStatus } from "./toss-trading-adapter.js";
import {
  registerUserAuthRoutes,
  requireUserAuth,
  resolveUserFromRequest,
} from "./user-auth.js";
import { listPollersStatusSync, setPollerRuntimeEnabled } from "./poller-registry.js";
import { sendChatNoCodeTelegram } from "./ops-chat-no-code-notify.js";
import { registerUserCredentialRoutes } from "./user-credentials-routes.js";
import {
  getBithumbTradingStatusForUserSync,
  listCredentialMetaForUserSync,
} from "./user-credentials-store.js";
import { isCredentialsCryptoReady } from "./credentials-crypto.js";
import {
  fetchQuoteSnapshotsForSymbols,
  mergeLiveQuotesIntoPicksState,
} from "./picks-live-quotes.js";
import { enrichUnifiedQueueAgentAndRecord } from "./ops-unified-queue-seq.js";
import { readDevQueueDisplaySnapshotSync } from "./ops-dev-queue-live-store.js";
import {
  FILE_DEV_POLL_MS,
  appendFileDevPendingJob,
  mergeFileDevQueueFromClient,
  readFileDevQueueSync,
} from "./ops-file-dev-store.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const __createAppDir = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__createAppDir, "..", "dist");
const DIST_INDEX_HTML = path.join(DIST_DIR, "index.html");

/**
 * `npm run build` 산출물이 있으면 API와 동일 포트에서 SPA를 제공한다.
 * (그렇지 않으면 API 전용 — 개발은 Vite가 문서를 담당)
 */
function installDistSpaIfPresent(app) {
  if (!fs.existsSync(DIST_INDEX_HTML)) return;

  app.use(
    express.static(DIST_DIR, {
      index: false,
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    const raw = String(req.originalUrl ?? req.url ?? "/");
    const pathname = raw.split("?")[0].split("#")[0] || "/";
    const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
    if (p.startsWith("/api")) {
      res.status(404).json({
        error: "요청한 API를 찾을 수 없습니다.",
        code: "API_NOT_FOUND",
        path: p,
      });
      return;
    }
    res.sendFile(path.resolve(DIST_INDEX_HTML), (err) => {
      if (err) next(err);
    });
  });
}

/** Cursor IDE 개발 큐 — 로컬 훅 전용 */
function isLoopbackDevQueueRequest(req) {
  const ip = normalizeAccessIp(expressClientIp(req));
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const ra = String(req.socket?.remoteAddress ?? "");
  return !ip && (ra === "127.0.0.1" || ra === "::1" || ra.endsWith("127.0.0.1"));
}

/** @param {import("express").Response} res @param {unknown} err */
function respondIdeDevQueueError(res, err) {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String(/** @type {{ code?: string }} */ (err).code)
      : "";
  if (code === "OPS_QUEUE_FULL") {
    res.status(503).json({ error: msg, code });
    return;
  }
  if (code === "IDE_SESSION_BUSY") {
    res.status(409).json({ error: msg, code });
    return;
  }
  if (code === "IDE_LEASE_NOT_FOUND") {
    res.status(404).json({ error: msg, code });
    return;
  }
  res.status(500).json({ error: msg, code: code || undefined });
}

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  installMobileApkDownload(app);
  installMobileIosDownload(app);

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {{ code: string; messageKo: string }} bad
   */
  async function respondInstructionPolicyBlock(req, res, bad) {
    const rip = normalizeAccessIp(expressClientIp(req));
    const rejectedId = randomUUID();
    appendServerEventLog(
      "ops-agent",
      `instruction policy reject code=${bad.code} id=${rejectedId}`,
      "warn",
      rip || null,
    );
    res.status(422).json({
      error: bad.messageKo,
      code: bad.code,
      rejectedRunId: rejectedId,
    });
  }

  app.use(express.json());
  app.use(expressAccessLogger);
  registerAccessControl(app);
  registerUiFeatureToggleRoutes(app);
  registerUserAuthRoutes(app);
  registerUserCredentialRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, atMs: Date.now() });
  });

  app.post(
    "/api/server-open-request",
    asyncRoute(async (req, res) => {
      try {
        const origin =
          String(req.headers.origin ?? "").trim() ||
          String(req.headers.referer ?? "").trim() ||
          String(req.get?.("host") ?? "").trim();
        const result = await notifyServerOpenRequest({
          origin,
          userAgent: String(req.headers["user-agent"] ?? ""),
          via: "api",
        });
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(502).json({ ok: false, error: message });
      }
    }),
  );

  app.get(
    "/api/picks",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      ensureScreening();
      const base = getPicksState();
      let merged = base;
      try {
        merged = await mergeLiveQuotesIntoPicksState(base);
      } catch {
        /* 시세 병합 실패 시 스크리너 스냅샷만 반환 */
      }
      res.json(enrichPicksStateWithHistory(merged));
    }),
  );

  app.get("/api/picks/daily-history", requireAccessAdmin, (_req, res) => {
    res.json(getPicksDailyHistoryForApi());
  });

  app.get(
    "/api/picks/daily-history/quotes",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const raw = String(req.query.symbols ?? "").trim();
      const symbols = raw
        ? raw
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const fresh = String(req.query.fresh ?? "").trim() === "1";
      const quotes = await fetchQuoteSnapshotsForSymbols(symbols, {
        maxAgeMs: fresh ? 0 : undefined,
      });
      res.json({ quotes });
    }),
  );

  app.get(
    "/api/picks/recommendations-tracker",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const includeQuotes = String(req.query.quotes ?? "1").trim() !== "0";
      const forceRefresh = String(req.query.refresh ?? "").trim() === "1";

      if (!forceRefresh && !includeQuotes) {
        const snap = readRecommendationsTrackerSnapshotSync();
        if (snap) {
          if (isRecommendationsTrackerSnapshotStale(snap)) {
            scheduleRecommendationsTrackerSnapshotRefresh();
          }
          res.json(
            decorateRecommendationsTrackerResponse(snap.payload, {
              writtenAtMs: snap.writtenAtMs,
              fromSnapshot: true,
            }),
          );
          return;
        }
      }

      const payload = await buildRecommendationsTrackerPayload({ includeQuotes });
      res.json(
        decorateRecommendationsTrackerResponse(payload, {
          fromSnapshot: false,
        }),
      );
    }),
  );

  app.get("/api/picks/tech-weights", requireAccessAdmin, (_req, res) => {
    const meta = getTechWeightsMetaSync();
    res.json({
      weights: getActiveSignalScoreWeightsSync(),
      defaults: getDefaultSignalScoreWeights(),
      maxTechScore: getMaxTechScoreSync(),
      revision: meta.revision,
      updatedAtMs: meta.updatedAtMs,
      lastBaselineWinRatePct: meta.lastBaselineWinRatePct,
    });
  });

  app.post(
    "/api/picks/tech-weights/apply",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const raw = req.body?.weights;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.status(400).json({ error: "weights 객체가 필요합니다." });
        return;
      }
      const baseline = req.body?.baselineWinRatePct;
      const applied = applyTechWeights(raw, {
        baselineWinRatePct:
          typeof baseline === "number" && Number.isFinite(baseline) ? baseline : null,
      });
      res.json({
        ok: true,
        weights: applied.weights,
        revision: applied.revision,
        maxTechScore: getMaxTechScoreSync(),
        updatedAtMs: Date.now(),
      });
    }),
  );

  app.post("/api/picks/tech-weights/reset", requireAccessAdmin, (_req, res) => {
    resetDefaultTechModelWeightsSync();
    resetTechWeightsSync();
    const listed = listTechModelsSync();
    res.json({
      ok: true,
      weights: getActiveSignalScoreWeightsSync(),
      defaults: getDefaultSignalScoreWeights(),
      maxTechScore: getMaxTechScoreSync(),
      revision: 0,
      updatedAtMs: null,
      ...listed,
    });
  });

  app.get("/api/picks/tech-models", requireAccessAdmin, (_req, res) => {
    res.json(listTechModelsSync());
  });

  app.post(
    "/api/picks/tech-models",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const name = String(req.body?.name ?? "").trim();
      if (!name) {
        res.status(400).json({ error: "모델 이름이 필요합니다." });
        return;
      }
      const model = createTechModelSync({
        name,
        weights: req.body?.weights,
        copyFromId: req.body?.copyFromId,
      });
      res.json({ ok: true, model, ...listTechModelsSync() });
    }),
  );

  app.patch(
    "/api/picks/tech-models/active",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const ids = req.body?.activeModelIds;
      if (!Array.isArray(ids)) {
        res.status(400).json({ error: "activeModelIds 배열이 필요합니다." });
        return;
      }
      setActiveTechModelIdsSync(ids);
      res.json({ ok: true, ...listTechModelsSync() });
    }),
  );

  app.patch(
    "/api/picks/tech-models/:id",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const model = updateTechModelSync(id, {
          name: req.body?.name,
          weights: req.body?.weights,
        });
        res.json({ ok: true, model, ...listTechModelsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.delete(
    "/api/picks/tech-models/:id",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        deleteTechModelSync(id);
        res.json({ ok: true, ...listTechModelsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.get("/api/live-trading/tech-models", requireUserAuth, (_req, res) => {
    res.json(listTechModelsForLiveTradingSync());
  });

  app.get(
    "/api/live-trading/status",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const userId = req.user.id;
      const { ensureUserTradingFeesFreshAsync, getUserTradingFeeRatesForApiSync } =
        await import("./exchange-trading-fees.js");
      await ensureUserTradingFeesFreshAsync(userId);
      const feeRates = getUserTradingFeeRatesForApiSync(userId);
      const creds = listCredentialMetaForUserSync(userId);
      const toss =
        creds.toss.source === "user"
          ? {
              phase: creds.toss.ready
                ? "ready"
                : creds.toss.configured
                  ? "configured"
                  : "unconfigured",
              configured: creds.toss.configured,
              ready: creds.toss.ready,
              messageKo: creds.toss.messageKo,
              hasSecret: creds.toss.hasSecret,
              hasAccount: Boolean(creds.toss.hasAccount),
              baseUrl: null,
              docsHint: "https://docs.tossinvest.com",
            }
          : getTossTradingStatus();
      const bithumb = getBithumbTradingStatusForUserSync(userId);
      migrateProgramsForAccountOnceSync(userId, req.user.email);
      await ensureLiveTradeSellSettingsMigratedOnce();
      await ensureLiveTradeExitScenarioMigratedOnce();
      let programs = listLiveTradeProgramsForUserSync(userId, req.user.email);
      let programReturns = await buildProgramPortfolioSummariesMap(
        programs.map((p) => p.id),
        userId,
      );
      programReturns = await enrichProgramReturnsFromHoldings(
        programReturns,
        userId,
      );
      programs = healStuckSimProgramErrorsSync(programs, programReturns);
      programs = healOwnerMissingProgramErrorsSync(programs);
      res.json({
        toss,
        bithumb,
        programs,
        programReturns,
        armedCount: programs.filter((p) => p.status === "armed").length,
        simCount: programs.filter((p) => p.status === "sim").length,
        credentialsCryptoReady: isCredentialsCryptoReady(),
        simulatedOrders:
          creds.toss.source === "user"
            ? !creds.toss.liveOrdersEnabled
            : process.env.TOSS_LIVE_ORDERS_ENABLED !== "1",
        tossSimulatedOrders:
          creds.toss.source === "user"
            ? !creds.toss.liveOrdersEnabled
            : process.env.TOSS_LIVE_ORDERS_ENABLED !== "1",
        bithumbSimulatedOrders: false,
        feeRates,
      });
    }),
  );

  app.post(
    "/api/live-trading/programs",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const userId = req.user.id;
        const program = createLiveTradeProgramSync(
          {
            name: String(req.body?.name ?? ""),
            modelId: String(req.body?.modelId ?? ""),
            markets: req.body?.markets,
            minScoreRatio: req.body?.minScoreRatio,
            maxOpenPositions: req.body?.maxOpenPositions,
            orderAmountKrw: req.body?.orderAmountKrw,
            orderAmountUsd: req.body?.orderAmountUsd,
            simAutoBuy: req.body?.simAutoBuy,
            autoSellAtTarget: req.body?.autoSellAtTarget,
            takeProfitPct: req.body?.takeProfitPct,
            stopLossPct: req.body?.stopLossPct,
            sellHorizon: req.body?.sellHorizon,
          },
          userId,
          req.user.email,
        );
        res.json({
          ok: true,
          program,
          programs: listLiveTradeProgramsForUserSync(userId),
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.patch(
    "/api/live-trading/programs/:id",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const userId = req.user.id;
      try {
        const program = updateLiveTradeProgramSync(
          id,
          {
            name: req.body?.name,
            modelId: req.body?.modelId,
            markets: req.body?.markets,
            minScoreRatio: req.body?.minScoreRatio,
            maxOpenPositions: req.body?.maxOpenPositions,
            orderAmountKrw: req.body?.orderAmountKrw,
            orderAmountUsd: req.body?.orderAmountUsd,
            simAutoBuy: req.body?.simAutoBuy,
            autoSellAtTarget: req.body?.autoSellAtTarget,
            takeProfitPct: req.body?.takeProfitPct,
            stopLossPct: req.body?.stopLossPct,
            sellHorizon: req.body?.sellHorizon,
          },
          userId,
        );
        res.json({
          ok: true,
          program,
          programs: listLiveTradeProgramsForUserSync(userId),
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.delete(
    "/api/live-trading/programs/:id",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const userId = req.user.id;
      try {
        deleteLiveTradeProgramSync(id, userId);
        res.json({
          ok: true,
          deletedId: id,
          programs: listLiveTradeProgramsForUserSync(userId),
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/arm",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const userId = req.user.id;
      try {
        const lane = String(req.body?.lane ?? "").trim().toLowerCase();
        if (lane !== "bithumb" && lane !== "toss") {
          res.status(400).json({
            error: "lane 값이 필요합니다. (bithumb | toss)",
          });
          return;
        }
        const gate = validateLiveTradeArmLane(
          getLiveTradeProgramSync(id, userId) ?? { markets: {} },
          /** @type {"bithumb"|"toss"} */ (lane),
          userId,
        );
        const program = armLiveTradeProgramLaneSync(
          id,
          /** @type {"bithumb"|"toss"} */ (lane),
          userId,
        );
        res.json({
          ok: true,
          program,
          lane: gate.lane,
          toss: gate.toss,
          bithumb: gate.bithumb,
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/disarm",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const program = disarmLiveTradeProgramSync(id, req.user.id);
        res.json({ ok: true, program });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/sim-start",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const userId = req.user.id;
      try {
        const program = startSimLiveTradeProgramSync(id, userId);
        res.json({
          ok: true,
          program,
          programs: listLiveTradeProgramsForUserSync(userId),
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/sim-stop",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const userId = req.user.id;
      try {
        const program = stopSimLiveTradeProgramSync(id, userId);
        res.json({
          ok: true,
          program,
          programs: listLiveTradeProgramsForUserSync(userId),
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.get(
    "/api/live-trading/sim-recommendations",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      res.json(buildSimCreationRecommendations(req.user.id));
    }),
  );

  app.get(
    "/api/live-trading/programs/:id/sim-feedback",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        res.json(analyzeSimProgramFeedback(id, req.user.id));
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/sim-feedback/apply",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const userId = req.user.id;
      try {
        const out = applySimProgramFeedbackPatch(id, userId);
        res.json({
          ok: true,
          program: out.program,
          analysis: out.analysis,
          programs: listLiveTradeProgramsForUserSync(userId),
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.get(
    "/api/live-trading/quotes",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const raw = String(req.query.symbols ?? "").trim();
      const symbols = raw
        ? raw
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const { fetchQuoteSnapshotsForSymbols } = await import(
        "./picks-live-quotes.js"
      );
      const quotes = await fetchQuoteSnapshotsForSymbols(symbols, {
        maxAgeMs: 0,
      });
      res.json({ quotes, interval: "1m", updatedAtMs: Date.now() });
    }),
  );

  app.get(
    "/api/live-trading/trades/history",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const endDay = String(req.query?.endDay ?? "").trim() || undefined;
      const days = req.query?.days;
      const all =
        String(req.query?.all ?? "").trim() === "1" ||
        String(req.query?.all ?? "").trim() === "true";
      const programId = String(req.query?.programId ?? "").trim() || undefined;
      const exchangeRaw = String(req.query?.exchange ?? "").trim().toLowerCase();
      const exchange =
        exchangeRaw === "bithumb" || exchangeRaw === "toss"
          ? exchangeRaw
          : undefined;
      const scenarioRaw = String(req.query?.scenario ?? "").trim().toLowerCase();
      const scenario =
        scenarioRaw === "sim" ||
        scenarioRaw === "live-bithumb" ||
        scenarioRaw === "live-toss"
          ? scenarioRaw
          : undefined;
      const { buildLiveTradeHistoryPayloadAsync } = await import(
        "./live-trade-history.js"
      );
      const payload = await buildLiveTradeHistoryPayloadAsync(req.user.id, {
        endDay,
        days: days != null ? Number(days) : 1,
        all,
        programId,
        exchange,
        scenario,
      });
      res.json(payload);
    }),
  );

  app.get(
    "/api/live-trading/box-range/status",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const { buildBoxRangeStatusForUserSync } = await import(
        "./box-range/program-snapshot.js"
      );
      res.json(buildBoxRangeStatusForUserSync(req.user.id));
    }),
  );

  app.get(
    "/api/box-range/overlay",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const symbol = String(req.query?.symbol ?? "").trim().toUpperCase();
      if (!symbol) {
        res.status(400).json({ error: "symbol required" });
        return;
      }
      const chartTimeframe = String(req.query?.timeframe ?? "").trim() || "1h";
      const { buildChartBoxRangeOverlayAsync } = await import(
        "./box-range/chart-overlay.js"
      );
      const { boxes, scan } = await buildChartBoxRangeOverlayAsync(
        symbol,
        chartTimeframe,
        req.user.id,
      );
      res.json({ symbol, timeframe: chartTimeframe, boxes, scan });
    }),
  );

  app.get(
    "/api/box-range/catalog",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const { readCatalogIndexSync, resolveCatalogMarket, resolveCatalogRootDir } = await import(
        "./box-range/catalog-store.js"
      );
      const { getKoreanStockName } = await import("./names-ko.js");
      const market = resolveCatalogMarket(req.query?.market);
      const strategy = String(req.query?.strategy ?? "").trim() || undefined;
      const catalogRoot = resolveCatalogRootDir(strategy);
      const idx = readCatalogIndexSync(market, catalogRoot);
      if (market === "us" && Array.isArray(idx.symbols)) {
        res.json({
          ...idx,
          symbols: idx.symbols.map((row) => {
            const sym = String(row.symbol ?? "").trim().toUpperCase();
            const nameKo = getKoreanStockName(sym);
            return nameKo ? { ...row, nameKo } : row;
          }),
        });
        return;
      }
      res.json(idx);
    }),
  );

  app.get(
    "/api/box-range/catalog/:symbol",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const symbol = String(req.params?.symbol ?? "").trim().toUpperCase();
      const { readSymbolCatalogSync, resolveCatalogMarket, resolveCatalogRootDir } = await import(
        "./box-range/catalog-store.js"
      );
      const market = resolveCatalogMarket(req.query?.market);
      const strategy = String(req.query?.strategy ?? "").trim() || undefined;
      const catalogRoot = resolveCatalogRootDir(strategy);
      const cat = readSymbolCatalogSync(symbol, market, catalogRoot);
      if (!cat) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(cat);
    }),
  );

  app.patch(
    "/api/box-range/catalog/:symbol/boxes/:catalogBoxId",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const symbol = String(req.params?.symbol ?? "").trim().toUpperCase();
      const catalogBoxId = String(req.params?.catalogBoxId ?? "").trim();
      const tradeEligible = req.body?.tradeEligible;
      const { patchCatalogBoxSync, resolveCatalogMarket, resolveCatalogRootDir } = await import(
        "./box-range/catalog-store.js"
      );
      const market = resolveCatalogMarket(req.query?.market ?? req.body?.market);
      const strategy = String(req.query?.strategy ?? req.body?.strategy ?? "").trim() || undefined;
      const catalogRoot = resolveCatalogRootDir(strategy);
      const reason =
        tradeEligible === false
          ? String(req.body?.consumedReason ?? "manual").trim() || "manual"
          : undefined;
      const box = patchCatalogBoxSync(
        symbol,
        catalogBoxId,
        {
          tradeEligible: tradeEligible === true ? true : false,
          consumedReason: reason,
        },
        market,
        catalogRoot,
      );
      if (!box) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ ok: true, box });
    }),
  );

  app.get(
    "/api/live-trading/portfolio",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const programId = String(req.query?.programId ?? "").trim() || null;
      const userId = req.user.id;
      const exchangeSyncLive =
        req.query?.exchangeSync === "1" || req.query?.exchangeSync === "true";
      const snap = await buildLiveTradePortfolioSnapshot({
        programId,
        userId,
        exchangeSyncLive,
      });
      const programs = listLiveTradeProgramsForUserSync(userId);
      const nameById = new Map(programs.map((p) => [p.id, p.name]));
      res.json({
        ...snap,
        holdings: snap.holdings.map((h) => ({
          ...h,
          programName: nameById.get(h.programId) ?? h.programId,
        })),
        trades: snap.trades.map((t) => ({
          ...t,
          programName: nameById.get(t.programId) ?? t.programId,
        })),
      });
    }),
  );

  app.post(
    "/api/live-trading/reconcile-holdings",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const userId = req.user.id;
      const dryRun = req.body?.dryRun === true || req.query?.dryRun === "1";
      const programId = String(req.body?.programId ?? req.query?.programId ?? "").trim() || undefined;
      const result = await reconcileBithumbHoldingsForUser(userId, {
        dryRun,
        programId,
      });
      res.json(result);
    }),
  );

  app.get(
    "/api/live-trading/bithumb/open-orders",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const payload = await buildBithumbOpenOrdersForUser(req.user.id);
      res.json(payload);
    }),
  );

  app.delete(
    "/api/live-trading/bithumb/orders/:orderId",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const orderId = String(req.params.orderId ?? "").trim();
        const payload = await cancelBithumbOpenOrderForUser(req.user.id, orderId);
        res.json({ ok: true, ...payload });
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.get(
    "/api/live-trading/toss/open-orders",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const payload = await buildTossOpenOrdersForUser(req.user.id);
      res.json(payload);
    }),
  );

  app.get(
    "/api/live-trading/toss/sellable-quantity",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const symbol = String(req.query?.symbol ?? "").trim();
        const market = String(req.query?.market ?? "kr").trim();
        const quantity = await fetchTossSellableQuantityForUser(
          req.user.id,
          symbol,
          market,
        );
        res.json({ ok: true, symbol, market, quantity });
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.post(
    "/api/live-trading/toss/orders",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const payload = await placeTossOrderForUser(req.user.id, req.body ?? {});
        res.json(payload);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.get(
    "/api/live-trading/toss/holdings/manage",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const payload = await buildTossHoldingsManageBoardForUser(req.user.id);
        res.json(payload);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.get(
    "/api/live-trading/toss/holdings/:symbol/report",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const symbol = String(req.params.symbol ?? "").trim();
        const market = String(req.query?.market ?? "kr").trim();
        const payload = await buildTossHoldingReportForUser(req.user.id, symbol, {
          market,
        });
        res.json(payload);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.put(
    "/api/live-trading/toss/holdings/:symbol/plan",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const symbol = String(req.params.symbol ?? "").trim();
        const payload = saveTossHoldingPlanForUser(req.user.id, symbol, req.body ?? {});
        res.json(payload);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.post(
    "/api/live-trading/toss/holdings/:symbol/execute",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const symbol = String(req.params.symbol ?? "").trim();
        const action = String(req.body?.action ?? "").trim().toLowerCase();
        const payload = await executeTossHoldingPlanOrderForUser(
          req.user.id,
          symbol,
          /** @type {"buy"|"sell"|"stop"} */ (action),
          req.body ?? {},
        );
        res.json(payload);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.delete(
    "/api/live-trading/toss/orders/:orderId",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const orderId = String(req.params.orderId ?? "").trim();
        const payload = await cancelTossOpenOrderForUser(req.user.id, orderId);
        res.json({ ok: true, ...payload });
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.post(
    "/api/live-trading/trades/sell",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const userId = req.user.id;
        const trade = recordLiveTradeSellSync(
          {
            programId: String(req.body?.programId ?? ""),
            symbol: String(req.body?.symbol ?? ""),
            market: req.body?.market,
            quantity: req.body?.quantity,
            price: Number(req.body?.price),
            note: req.body?.note,
            simulated: Boolean(req.body?.simulated),
            atMs: req.body?.atMs,
          },
          userId,
        );
        const snap = await buildLiveTradePortfolioSnapshot({
          programId: trade.programId,
          userId,
          forceFreshQuotes: true,
        });
        res.json({ ok: true, trade, portfolio: snap });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/simulate/buy",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const userId = req.user.id;
        const bodyPrice = Number(req.body?.price);
        const { trade, quote } = await recordLiveTradeSimBuyAsync(
          {
            programId: String(req.body?.programId ?? ""),
            symbol: String(req.body?.symbol ?? ""),
            market: req.body?.market,
            name: req.body?.name,
            price:
              Number.isFinite(bodyPrice) && bodyPrice > 0 ? bodyPrice : undefined,
          },
          userId,
        );
        const pfFilter = req.body?.portfolioProgramId;
        const snap = await buildLiveTradePortfolioSnapshot({
          programId:
            pfFilter != null && String(pfFilter).trim()
              ? String(pfFilter).trim()
              : null,
          userId,
          forceFreshQuotes: true,
        });
        const programs = listLiveTradeProgramsForUserSync(userId);
        const nameById = new Map(programs.map((p) => [p.id, p.name]));
        res.json({
          ok: true,
          trade: {
            ...trade,
            programName: nameById.get(trade.programId) ?? trade.programId,
          },
          quote,
          portfolio: snap,
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/simulate/sell",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const userId = req.user.id;
        const bodyPrice = Number(req.body?.price);
        const { trade, quote } = await recordLiveTradeSimSellAsync(
          {
            programId: String(req.body?.programId ?? ""),
            symbol: String(req.body?.symbol ?? ""),
            market: req.body?.market,
            quantity: req.body?.quantity,
            price:
              Number.isFinite(bodyPrice) && bodyPrice > 0 ? bodyPrice : undefined,
            note: req.body?.note,
          },
          userId,
        );
        const pfFilter = req.body?.portfolioProgramId;
        const snap = await buildLiveTradePortfolioSnapshot({
          programId:
            pfFilter != null && String(pfFilter).trim()
              ? String(pfFilter).trim()
              : null,
          userId,
          forceFreshQuotes: true,
        });
        const programs = listLiveTradeProgramsForUserSync(userId);
        const nameById = new Map(programs.map((p) => [p.id, p.name]));
        res.json({
          ok: true,
          trade: {
            ...trade,
            programName: nameById.get(trade.programId) ?? trade.programId,
          },
          quote,
          portfolio: snap,
        });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post("/api/picks/refresh", requireAccessAdmin, (_req, res) => {
    res.json(forceRescreen());
  });

  app.get(
    "/api/macro-events",
    asyncRoute(async (_req, res) => {
      res.json(await getMacroEventsCachedAsync());
    }),
  );

  app.get(
    "/api/sector-earnings",
    asyncRoute(async (_req, res) => {
      let sectorEarnings = [];
      try {
        sectorEarnings = await fetchSectorEarningsSpotlight();
      } catch {
        sectorEarnings = [];
      }
      res.json({ sectorEarnings, updatedAt: Date.now() });
    }),
  );

  app.get("/api/config", (req, res) => {
    const adminReq = isAccessAdminRequest(req);
    const cursorKey = String(process.env.CURSOR_API_KEY ?? "").trim();
    res.json({
      dartEnabled: isDartEnabled(),
      telegramNotify: getTelegramNotifyStatus(),
      feedbackInboxEnabled: true,
      telegramResetAllowed: adminReq,
      adminIpConsole: isAccessAdminIp(req),
      accessAdmin: adminReq,
      opsCursorAgentAvailable: adminReq && Boolean(cursorKey),
    });
  });

  app.post(
    "/api/admin/broadcast/box-range-strategy-email",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const { ensureBoxRangeScenarioRolloutOnce } = await import(
        "./box-range/migrate-active-programs.js"
      );
      const { sendBoxRangeStrategyEmailToLiveTradeUsers } = await import(
        "./notifications/box-range-strategy-email.js"
      );
      const force = Boolean(req.body?.force);
      const dryRun = Boolean(req.body?.dryRun);
      const migrateOnly = Boolean(req.body?.migrateOnly);
      const emailOnly = Boolean(req.body?.emailOnly);
      try {
        let migrate = null;
        if (!emailOnly) {
          migrate = await ensureBoxRangeScenarioRolloutOnce({
            force: true,
            sendEmail: false,
          });
        }
        let email = null;
        if (!migrateOnly) {
          email = await sendBoxRangeStrategyEmailToLiveTradeUsers({
            force,
            dryRun,
            allMembers: req.body?.allMembers !== false,
          });
        }
        const result = { migrate, email };
        res.json({ ok: true, ...result });
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
        res.status(code === "EMAIL_NOT_CONFIGURED" ? 503 : 500).json({
          error: e instanceof Error ? e.message : String(e),
          code,
        });
      }
    }),
  );

  app.post(
    "/api/admin/server-restart",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 서버를 재기동할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      if (!getServerRestartPasswordExpected()) {
        res.status(503).json({
          error:
            "SERVER_RESTART_PASSWORD 또는 ACCESS_ADMIN_TOKEN 이 서버 .env에 필요합니다.",
          code: "RESTART_PASSWORD_NOT_CONFIGURED",
        });
        return;
      }
      const password = String(req.body?.password ?? "").trim();
      if (!verifyServerRestartPassword(password)) {
        res.status(403).json({
          error: "재기동 비밀번호가 올바르지 않습니다.",
          code: "RESTART_PASSWORD_INVALID",
        });
        return;
      }
      const httpServer = req.socket?.server ?? null;
      res.json({
        ok: true,
        message: "재기동을 시작했습니다. 잠시 후 페이지가 새로고침됩니다.",
      });
      setTimeout(() => {
        void restartNodeOrViteDev(httpServer);
      }, 280);
    }),
  );

  app.get(
    "/api/pollers/status",
    requireUserAuth,
    (_req, res) => {
      res.json({ ok: true, pollers: listPollersStatusSync() });
    },
  );

  app.post(
    "/api/admin/pollers/:id/toggle",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const password = String(req.body?.password ?? "").trim();
      if (!verifyAccessAdminPassword(password)) {
        res.status(403).json({
          ok: false,
          error: "관리자 비밀번호가 올바르지 않습니다.",
          code: "ADMIN_PASSWORD_INVALID",
        });
        return;
      }
      const id = String(req.params.id ?? "").trim();
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        res.status(400).json({ ok: false, error: "enabled(boolean)가 필요합니다." });
        return;
      }
      try {
        const pollers = setPollerRuntimeEnabled(id, enabled);
        res.json({ ok: true, pollers });
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  app.post(
    "/api/ops/cursor-agent",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const instruction = String(req.body?.instruction ?? "").trim();
      if (!instruction) {
        res.status(400).json({ error: "instruction 필드에 요청 내용을 입력하세요." });
        return;
      }
      const pol = checkOpsInstructionPolicy(instruction);
      if (!pol.ok) {
        await respondInstructionPolicyBlock(req, res, {
          code: pol.code,
          messageKo: pol.messageKo,
        });
        return;
      }
      try {
        const rip = normalizeAccessIp(expressClientIp(req));
        const out = await enqueueOpsAgentJob(
          () =>
            runOpsCursorAgent({
              instruction,
              requestIp: rip,
            }),
          undefined,
          { requestIp: rip, instruction },
        );
        res.json({ ok: true, ...out });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code =
          err && typeof err === "object" && "code" in err
            ? String(err.code)
            : "";
        if (code === "OPS_QUEUE_FULL") {
          res.status(503).json({ error: msg, code: "OPS_QUEUE_FULL" });
          return;
        }
        if (code === "NO_API_KEY") {
          res.status(503).json({ error: msg, code: "NO_API_KEY" });
          return;
        }
        if (code === "AGENT_RUN_FAILED") {
          res.status(502).json({ error: msg, code: "AGENT_RUN_FAILED" });
          return;
        }
        if (String(code).startsWith("INSTRUCTION_POLICY_")) {
          res.status(422).json({ error: msg, code });
          return;
        }
        res.status(500).json({ error: msg });
      }
    }),
  );

  app.post(
    "/api/ops/cursor-agent-stream/cancel",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const runId = String(req.body?.runId ?? "").trim();
      if (!runId) {
        res.status(400).json({ error: "runId가 필요합니다." });
        return;
      }
      triggerOpsStreamUserCancel(runId);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/ops/cursor-agent-stream",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const instruction = String(req.body?.instruction ?? "").trim();
      if (!instruction) {
        res.status(400).json({
          error: "instruction 필드에 요청 내용을 입력하세요.",
        });
        return;
      }
      const pol = checkOpsInstructionPolicy(instruction);
      if (!pol.ok) {
        await respondInstructionPolicyBlock(req, res, {
          code: pol.code,
          messageKo: pol.messageKo,
        });
        return;
      }
      try {
        const rip = normalizeAccessIp(expressClientIp(req));
        const historyRunId = randomUUID();
        await enqueueOpsAgentJob(
          () => streamOpsCursorAgentSse(req, res, { instruction, historyRunId }),
          () => {
            writeOpsAgentSseEvent(res, {
              type: "phase",
              message:
                "앞선 에이전트 요청이 끝날 때까지 대기 중입니다. 곧 진행 상황이 표시됩니다.",
            });
          },
          { requestIp: rip, instruction, historyRunId },
        );
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String(/** @type {{ code?: string }} */ (e).code)
            : "";
        if (code === "OPS_QUEUE_FULL" && !res.headersSent) {
          const msg =
            e instanceof Error
              ? e.message
              : "운영 에이전트 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.";
          res.status(503).json({ error: msg, code: "OPS_QUEUE_FULL" });
          return;
        }
        throw e;
      }
    }),
  );

  app.post(
    "/api/ops/dev-queue/ide/enqueue",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const prompt = String(req.body?.prompt ?? "");
      const sessionId =
        String(req.body?.session_id ?? req.body?.sessionId ?? "").trim() || null;
      try {
        const reg = registerIdeDevQueueSlot({ prompt, sessionId });
        res.json(reg);
      } catch (err) {
        respondIdeDevQueueError(res, err);
      }
    }),
  );

  app.post(
    "/api/ops/dev-queue/ide/wait-grant",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const leaseId = String(req.body?.leaseId ?? req.body?.lease_id ?? "").trim();
      try {
        const grant = await waitIdeDevQueueGrant(leaseId);
        res.json({ ok: true, ...grant });
      } catch (err) {
        respondIdeDevQueueError(res, err);
      }
    }),
  );

  app.post(
    "/api/ops/dev-queue/ide/acquire",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const prompt = String(req.body?.prompt ?? "");
      const sessionId =
        String(req.body?.session_id ?? req.body?.sessionId ?? "").trim() || null;
      try {
        const grant = await acquireIdeDevQueueSlot({ prompt, sessionId });
        res.json({ ok: true, ...grant });
      } catch (err) {
        respondIdeDevQueueError(res, err);
      }
    }),
  );

  app.post(
    "/api/ops/dev-queue/ide/release",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const leaseId = String(req.body?.leaseId ?? req.body?.lease_id ?? "").trim();
      const out = releaseIdeDevQueueSlot({ leaseId });
      if (!out.ok) {
        res.status(404).json(out);
        return;
      }
      clearIdeLeaseOnDisk();
      res.json(out);
    }),
  );

  app.post(
    "/api/ops/chat-no-code-notify",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "로컬 요청에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const userRequest = String(
        req.body?.userRequest ?? req.body?.user_request ?? "",
      ).trim();
      const sessionId =
        String(req.body?.sessionId ?? req.body?.session_id ?? "").trim() ||
        null;
      if (!userRequest) {
        res.status(400).json({ error: "userRequest가 필요합니다." });
        return;
      }
      const sent = await sendChatNoCodeTelegram({ userRequest, sessionId });
      res.json({ ok: true, sent });
    }),
  );

  app.post(
    "/api/ops/dev-queue/ide/release-active",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const userRequest = String(
        req.body?.userRequest ?? req.body?.user_request ?? "",
      ).trim();
      const sessionId =
        String(req.body?.sessionId ?? req.body?.session_id ?? "").trim() ||
        null;
      const transcriptPath =
        String(req.body?.transcriptPath ?? req.body?.transcript_path ?? "").trim() ||
        null;
      const notify = userRequest
        ? { userRequest, sessionId, transcriptPath }
        : undefined;
      const out = releaseAnyRunningIdeDevQueueSlot(
        notify ? { notify } : {},
      );
      clearIdeLeaseOnDisk();
      res.json(out);
    }),
  );

  app.post(
    "/api/ops/dev-queue/claude-code/acquire",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({ error: "로컬 요청에서만 사용할 수 있습니다.", code: "FORBIDDEN" });
        return;
      }
      const prompt = String(req.body?.prompt ?? "").trim();
      if (!prompt) {
        res.status(400).json({ error: "prompt가 필요합니다.", code: "PROMPT_EMPTY" });
        return;
      }
      try {
        const reg = registerClaudeCodeQueueSlot({ prompt });
        const grant = await waitIdeDevQueueGrant(reg.leaseId);
        res.json({ ok: true, ...grant, queueSeq: reg.queueSeq });
      } catch (err) {
        respondIdeDevQueueError(res, err);
      }
    }),
  );

  app.post(
    "/api/ops/dev-queue/claude-code/release",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({ error: "로컬 요청에서만 사용할 수 있습니다.", code: "FORBIDDEN" });
        return;
      }
      const leaseId = String(req.body?.leaseId ?? req.body?.lease_id ?? "").trim();
      const out = releaseClaudeCodeQueueSlot({ leaseId });
      if (!out.ok) {
        res.status(404).json(out);
        return;
      }
      res.json(out);
    }),
  );

  app.post(
    "/api/ops/dev-queue/ide/cancel",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const leaseId = String(req.body?.leaseId ?? req.body?.lease_id ?? "").trim();
      const out = abandonIdeDevQueueSlot(leaseId);
      if (!out.ok) {
        res.status(404).json(out);
        return;
      }
      res.json(out);
    }),
  );

  app.get(
    "/api/ops/cursor-agent-pending",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const ip = normalizeAccessIp(expressClientIp(req));
      const p = ip ? getOpsAgentPendingForIp(ip) : null;
      res.json({
        instruction: p?.instruction ?? "",
        startedAtMs: p?.startedAtMs ?? null,
      });
    }),
  );

  /** @deprecated — 표시 SSOT는 dev-queue-display. 디스크 스냅샷만 반환. */
  app.get(
    "/api/ops/cursor-agent-queue",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const viewerIp = normalizeAccessIp(expressClientIp(req));
      const snap = readDevQueueDisplaySnapshotSync();
      res.json({
        entries: snap.agentEntries,
        viewerIp: viewerIp || null,
      });
    }),
  );

  /** 허용 IP — 개발 대기열: display 미러 파일(주기 sync) */
  app.get(
    "/api/ops/dev-queue-display",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const snap = readDevQueueDisplaySnapshotSync();
      const viewerIp = normalizeAccessIp(expressClientIp(req)) || null;
      res.json({
        ...snap,
        viewerIp,
      });
    }),
  );

  app.get(
    "/api/ops/record-mode",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 기록 모드를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const { items } = purgeRecordModeErrorItemsSync();
      const { recordItems } = enrichUnifiedQueueAgentAndRecord(items);
      res.json({ items: recordItems, pollIntervalMs: RECORD_MODE_POLL_MS });
    }),
  );

  app.get(
    "/api/ops/record-mode/activity",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 기록 모드를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const entries = readRecordModeActivityLogEntries();
      res.json({ entries });
    }),
  );

  app.put(
    "/api/ops/record-mode",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 기록 모드를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const raw = req.body?.items;
      const merged = await mergeRecordModeQueueFromClient(Array.isArray(raw) ? raw : []);
      const { recordItems } = enrichUnifiedQueueAgentAndRecord(merged.items);
      res.json({ ok: true, items: recordItems });
    }),
  );

  app.post(
    "/api/ops/record-mode/jobs",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 기록 모드를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const instruction = String(req.body?.instruction ?? "").trim();
      if (!instruction) {
        res.status(400).json({
          error: "instruction 필드에 요청 내용을 입력하세요.",
          code: "EMPTY_INSTRUCTION",
        });
        return;
      }
      const pol = checkOpsInstructionPolicy(instruction);
      if (!pol.ok) {
        await respondInstructionPolicyBlock(req, res, {
          code: pol.code,
          messageKo: pol.messageKo,
        });
        return;
      }
      const out = await appendRecordModePendingJob(instruction);
      if (!out.ok) {
        if (out.code === "QUEUE_FULL") {
          res.status(503).json({
            error:
              "기록 모드 큐가 가득 찼습니다. 완료·오류 항목을 정리한 뒤 다시 시도하세요.",
            code: "OPS_RECORD_MODE_QUEUE_FULL",
          });
          return;
        }
        res.status(400).json({
          error: "instruction 필드에 요청 내용을 입력하세요.",
          code: "EMPTY_INSTRUCTION",
        });
        return;
      }
      const { recordItems } = enrichUnifiedQueueAgentAndRecord(out.items);
      res.json({
        ok: true,
        id: out.id,
        items: recordItems,
        pollIntervalMs: RECORD_MODE_POLL_MS,
      });
    }),
  );

  app.get(
    "/api/ops/file-dev-queue",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 파일 반영 큐를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const { items, appliedFingerprints } = readFileDevQueueSync();
      res.json({ items, appliedFingerprints, pollIntervalMs: FILE_DEV_POLL_MS });
    }),
  );

  app.put(
    "/api/ops/file-dev-queue",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 파일 반영 큐를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const raw = req.body?.items;
      const merged = await mergeFileDevQueueFromClient(Array.isArray(raw) ? raw : []);
      res.json({ ok: true, ...merged });
    }),
  );

  app.post(
    "/api/ops/file-dev-queue/jobs",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 파일 반영 큐를 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const requestJson = String(req.body?.requestJson ?? "").trim();
      if (!requestJson) {
        res.status(400).json({
          error: "requestJson 필드에 반영할 JSON을 입력하세요.",
          code: "EMPTY_REQUEST_JSON",
        });
        return;
      }
      const out = await appendFileDevPendingJob(requestJson);
      if (!out.ok) {
        if (out.code === "QUEUE_FULL") {
          res.status(503).json({
            error:
              "파일 반영 큐가 가득 찼습니다. 반영 완료·오류 항목을 정리한 뒤 다시 시도하세요.",
            code: "OPS_FILE_DEV_QUEUE_FULL",
          });
          return;
        }
        res.status(400).json({
          error: "requestJson 필드에 반영할 JSON을 입력하세요.",
          code: "EMPTY_REQUEST_JSON",
        });
        return;
      }
      res.json({
        ok: true,
        id: out.id,
        items: out.items,
        appliedFingerprints: out.appliedFingerprints,
        pollIntervalMs: out.pollIntervalMs,
      });
    }),
  );

  app.post("/api/feedback", (req, res) => {
    postFeedback(req, res);
  });

  app.get("/api/feedback/inbox", requireAccessAdmin, (req, res) => {
    getFeedbackInbox(req, res);
  });

  app.post("/api/feedback/admin/reply", (req, res) => {
    postFeedbackAdminReply(req, res);
  });

  app.post("/api/feedback/admin/delete", (req, res) => {
    deleteFeedbackAdmin(req, res);
  });

  app.get("/api/telegram/sent", requireAccessAdmin, (_req, res) => {
    if (!isTelegramNotifyEnabled()) {
      res.status(400).json({
        error: "텔레그램 알림이 설정되지 않았습니다.",
      });
      return;
    }
    const items = listTodayTelegramSent();
    const pickBySymbol = new Map();
    for (const p of [
      ...getPicksState().kr,
      ...getPicksState().us,
      ...getPicksState().crypto,
    ]) {
      pickBySymbol.set(`${p.market}:${p.symbol}`, p);
    }
    const enriched = items.map((item) => {
      const pick = pickBySymbol.get(`${item.market}:${item.symbol}`);
      if (!pick) return item;
      return {
        ...item,
        name: item.name === item.symbol && pick.name ? pick.name : item.name,
        currency: item.currency ?? pick.currency ?? null,
      };
    });
    res.json({ items: enriched, count: enriched.length });
  });

  app.post("/api/telegram/reset-sent", (req, res) => {
    if (!isTelegramNotifyEnabled()) {
      res.status(400).json({
        ok: false,
        message: "텔레그램 알림이 설정되지 않았습니다.",
      });
      return;
    }
    if (!isAccessAdminRequest(req)) {
      res.status(403).json({
        ok: false,
        message: "알림 초기화는 관리자(토큰 또는 등록 IP)만 사용할 수 있습니다.",
      });
      return;
    }
    const { removed } = clearTodayTelegramSent();
    res.json({
      ok: true,
      removed,
      message:
        removed > 0
          ? `오늘 알림 이력 ${removed}건을 초기화했습니다. 조건 충족 시 다시 알림됩니다.`
          : "초기화할 오늘 알림 이력이 없습니다.",
    });
  });

  app.get(
    "/api/news/:symbol",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      try {
        const symbol = req.params.symbol.toUpperCase();
        const name = String(req.query.name ?? "");
        const data = await loadNews(symbol, name);
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/dart/status",
    asyncRoute(async (_req, res) => {
      res.json(getDartStatus());
    }),
  );

  app.get(
    "/api/dart/companies",
    asyncRoute(async (req, res) => {
      if (!isDartEnabled()) {
        res.json({ enabled: false, items: [] });
        return;
      }
      const q = String(req.query.q ?? "").trim();
      if (q.length < 1) {
        res.status(400).json({ error: "검색어를 입력하세요." });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
      try {
        const items = await searchDartCompanies(q, limit);
        res.json({ enabled: true, items });
      } catch (err) {
        const message = err instanceof Error ? err.message : "검색 실패";
        res.status(502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/dart/disclosures",
    asyncRoute(async (req, res) => {
      const q = String(req.query.q ?? "").trim();
      const symbol = String(req.query.symbol ?? "").trim().toUpperCase();
      const corpCode = String(req.query.corpCode ?? "").trim();
      if (!q && !symbol && !corpCode) {
        res.status(400).json({ error: "회사 선택 또는 공시 검색어가 필요합니다." });
        return;
      }
      if (symbol && !/^[0-9]{6}\.(KS|KQ)$/i.test(symbol)) {
        res.status(400).json({ error: "국내 종목 심볼(예: 005930.KS)만 지원합니다." });
        return;
      }
      try {
        const data = await searchDartDisclosures({
          query: q,
          symbol,
          corpCode,
          days: Number(req.query.days),
          page: Number(req.query.page),
          pageSize: Number(req.query.pageSize),
        });
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "공시 조회 실패";
        res.status(502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/crypto-universe",
    asyncRoute(async (_req, res) => {
      try {
        const data = await loadCryptoWatchlistTen();
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/crypto-quotes",
    asyncRoute(async (req, res) => {
      try {
        const raw = String(req.query.symbols ?? "").trim();
        const symbols = raw
          ? raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        const data = await loadCryptoQuotes(symbols);
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/fx/usd-krw",
    asyncRoute(async (_req, res) => {
      try {
        const data = await getUsdKrwRate();
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/market-indices",
    asyncRoute(async (_req, res) => {
      try {
        res.json(await getMarketIndices());
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock-vault/favorites",
    asyncRoute(async (req, res) => {
      const { buildStockVaultItemsForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const user = resolveUserFromRequest(req);
      const { authenticated, favoriteSymbols, favoriteMeta } =
        buildStockVaultItemsForUserSync(user?.id);
      res.json({ authenticated, favoriteSymbols, favoriteMeta });
    }),
  );

  app.get(
    "/api/stock-vault",
    asyncRoute(async (req, res) => {
      const { buildStockVaultItemsForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const { readStockVaultMetaForItemsSync, scheduleStockVaultMetaRefresh, listStockVaultIndustryTabs, stockVaultIndustryGridRows } =
        await import("./stock-vault-meta.js");
      const user = resolveUserFromRequest(req);
      const { items, authenticated, favoriteSymbols, favoriteMeta } =
        buildStockVaultItemsForUserSync(user?.id);
      const symbols = items.map((it) => it.symbol);
      const meta = readStockVaultMetaForItemsSync(items);
      const lite = String(req.query?.lite ?? "") === "1";
      const industryTabs = listStockVaultIndustryTabs();
      /** @type {Record<string, unknown>} */
      const payload = {
        items,
        meta,
        industryTabs,
        industryGridRows: stockVaultIndustryGridRows(industryTabs.length),
        authenticated,
        favoriteSymbols,
        favoriteMeta,
      };
      if (lite) {
        if (symbols.length > 0) {
          scheduleStockVaultMetaRefresh(items);
        }
        res.json(payload);
        return;
      }
      const quotes =
        symbols.length > 0
          ? await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 120_000 })
          : {};
      const {
        readStockVaultChartInsightsSync,
        scheduleStockVaultChartInsightsRefresh,
        pickVaultMapBySymbols,
      } = await import("./stock-vault-chart-insights.js");
      const { readStockVaultIndustryFinancialsSync } = await import(
        "./stock-vault-industry-financials.js"
      );
      const chartInsightsAll = readStockVaultChartInsightsSync();
      const chartInsights = pickVaultMapBySymbols(chartInsightsAll, symbols);
      if (symbols.length > 0) {
        scheduleStockVaultMetaRefresh(items);
        scheduleStockVaultChartInsightsRefresh(symbols, quotes);
      }
      const industryFinancialsAll = readStockVaultIndustryFinancialsSync();
      res.json({
        ...payload,
        quotes,
        chartInsights,
        industryFinancials: pickVaultMapBySymbols(industryFinancialsAll, symbols),
      });
    }),
  );

  app.get(
    "/api/kr-investor-flow",
    asyncRoute(async (req, res) => {
      const { readKrInvestorFlowSnapshotSync, runKrInvestorFlowScan } =
        await import("./kr-investor-flow.js");
      const refresh = String(req.query?.refresh ?? "") === "1";
      const snapshot = refresh
        ? await runKrInvestorFlowScan()
        : readKrInvestorFlowSnapshotSync();
      res.json(snapshot);
    }),
  );

  app.get(
    "/api/kr-investor-flow/:symbol/holdings",
    asyncRoute(async (req, res) => {
      const sym = String(req.params.symbol ?? "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9]{6}(?:\.(KS|KQ))?$/i.test(sym)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      const { readKrInvestorFlowSnapshotSync, loadKrInvestorFlowHoldingsDetail } =
        await import("./kr-investor-flow.js");
      const snap = readKrInvestorFlowSnapshotSync();
      const rowHint =
        snap.items?.find(
          (it) =>
            String(it.symbol ?? "")
              .trim()
              .toUpperCase() === sym ||
            String(it.symbol ?? "")
              .replace(/\.(KS|KQ)$/i, "")
              .toUpperCase() === sym.replace(/\.(KS|KQ)$/i, ""),
        ) ?? null;
      try {
        const data = await loadKrInvestorFlowHoldingsDetail(sym, rowHint);
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock-vault/quotes",
    asyncRoute(async (req, res) => {
      const raw = String(req.query.symbols ?? "").trim();
      const symbols = raw
        ? raw
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const quotes =
        symbols.length > 0
          ? await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 })
          : {};
      res.json({ quotes, updatedAtMs: Date.now() });
    }),
  );

  app.get(
    "/api/stock-vault/industry-financials",
    asyncRoute(async (req, res) => {
      const { readStockVaultIndustryFinancialsSync } = await import(
        "./stock-vault-industry-financials.js"
      );
      const { pickVaultMapBySymbols } = await import(
        "./stock-vault-chart-insights.js"
      );
      const raw = String(req.query?.symbols ?? "").trim();
      const symbols = raw
        ? raw
            .split(/[,\s]+/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [];
      const all = readStockVaultIndustryFinancialsSync();
      const industryFinancials = pickVaultMapBySymbols(
        all,
        symbols.length ? symbols : Object.keys(all),
      );
      res.json({ industryFinancials, updatedAtMs: Date.now() });
    }),
  );

  app.get(
    "/api/stock-vault/chart-insights",
    asyncRoute(async (req, res) => {
      const { buildStockVaultItemsForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const {
        readStockVaultChartInsightsSync,
        fetchStockVaultChartInsightsMap,
        pickVaultMapBySymbols,
      } = await import("./stock-vault-chart-insights.js");
      const { fetchQuoteSnapshotsForSymbols } = await import(
        "./picks-live-quotes.js"
      );
      const user = resolveUserFromRequest(req);
      const { items } = buildStockVaultItemsForUserSync(user?.id);
      const rawSyms = String(req.query?.symbols ?? "").trim();
      const symbols = rawSyms
        ? rawSyms
            .split(/[,\s]+/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : items.map((it) => it.symbol);
      const force = String(req.query?.refresh ?? "") === "1";
      let quotes = {};
      if (symbols.length > 0) {
        quotes = await fetchQuoteSnapshotsForSymbols(symbols);
      }
      const chartInsightsAll = force
        ? await fetchStockVaultChartInsightsMap(symbols, quotes)
        : readStockVaultChartInsightsSync();
      const chartInsights = pickVaultMapBySymbols(chartInsightsAll, symbols);
      if (!force && symbols.length > 0) {
        const { scheduleStockVaultChartInsightsRefresh } = await import(
          "./stock-vault-chart-insights.js"
        );
        scheduleStockVaultChartInsightsRefresh(symbols, quotes);
      }
      res.json({
        chartInsights,
        updatedAtMs: Date.now(),
      });
    }),
  );

  app.post(
    "/api/stock-vault",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const { addStockVaultItemForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const symbol = String(req.body?.symbol ?? "").trim();
      const market = req.body?.market === "us" ? "us" : "kr";
      const name = String(req.body?.name ?? "").trim();
      const favoritePrice = req.body?.favoritePrice;
      if (!symbol) {
        res.status(400).json({ error: "symbol이 필요합니다." });
        return;
      }
      try {
        const item = addStockVaultItemForUserSync(req.user.id, {
          symbol,
          market,
          name: name || symbol,
          favoritePrice,
        });
        res.json({ item: { ...item, favorited: true } });
      } catch (e) {
        const message = e instanceof Error ? e.message : "저장 실패";
        res.status(400).json({ error: message });
      }
    }),
  );

  app.post(
    "/api/stock-vault/:symbol/favorite",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const { setStockVaultFavoriteForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const symbol = decodeURIComponent(String(req.params.symbol ?? "")).trim();
      if (!symbol) {
        res.status(400).json({ error: "symbol이 필요합니다." });
        return;
      }
      const favorited = req.body?.favorited !== false;
      const favoritePrice = req.body?.favoritePrice;
      const name = String(req.body?.name ?? "").trim() || undefined;
      const market = req.body?.market === "us" ? "us" : req.body?.market === "kr" ? "kr" : undefined;
      const result = setStockVaultFavoriteForUserSync(req.user.id, symbol, favorited, {
        favoritePrice,
        name,
        market,
      });
      res.json({ ok: true, favorited: result.favorited, meta: result.meta });
    }),
  );

  app.patch(
    "/api/stock-vault/:symbol/favorite-meta",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const { patchStockVaultFavoriteMetaForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const symbol = decodeURIComponent(String(req.params.symbol ?? "")).trim();
      if (!symbol) {
        res.status(400).json({ error: "symbol이 필요합니다." });
        return;
      }
      try {
        const meta = patchStockVaultFavoriteMetaForUserSync(req.user.id, symbol, {
          favoritePrice: req.body?.favoritePrice,
        });
        res.json({ ok: true, meta });
      } catch (e) {
        const code = e && typeof e === "object" && "code" in e ? e.code : null;
        if (code === "NOT_FAVORITED" || code === "META_MISSING") {
          res.status(404).json({ error: "즐겨찾기 정보를 찾을 수 없습니다." });
          return;
        }
        const message = e instanceof Error ? e.message : "저장 실패";
        res.status(400).json({ error: message });
      }
    }),
  );

  app.delete(
    "/api/stock-vault/:symbol",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const { removeStockVaultItemForUserSync } = await import(
        "./stock-vault-view.js"
      );
      const symbol = decodeURIComponent(String(req.params.symbol ?? "")).trim();
      if (!symbol) {
        res.status(400).json({ error: "symbol이 필요합니다." });
        return;
      }
      const result = removeStockVaultItemForUserSync(req.user.id, symbol);
      if (!result.removedFavorite && !result.dismissed) {
        res.status(404).json({ error: "종목을 찾을 수 없습니다." });
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  app.get(
    "/api/golden-cross/status",
    asyncRoute(async (_req, res) => {
      const { getGoldenCrossScanStateSync } = await import("./golden-cross-scan.js");
      const { getMaAlignScanStateSync } = await import("./ma-align-scan.js");
      const { getMa120NearScanStateSync } = await import("./ma120-near-scan.js");
      const { getCandleLowSlopeScanStateSync } = await import("./candle-low-slope-scan.js");
      const { getBookAccumulationScanStateSync } = await import("./book-accumulation-scan.js");
      const {
        goldenCrossScanEnabled,
        getLastGoldenCrossManualScanResult,
        isGoldenCrossManualScanRunning,
      } = await import("./golden-cross-poller.js");
      const { getBottomCandleScanStateSync } = await import("./bottom-candle-scan.js");
      const {
        bottomCandleScanEnabled,
        getLastBottomCandleManualScanResult,
        isBottomCandleManualScanRunning,
      } = await import("./bottom-candle-poller.js");
      res.json({
        enabled: goldenCrossScanEnabled(),
        running: isGoldenCrossManualScanRunning(),
        lastManualScan: getLastGoldenCrossManualScanResult(),
        goldenCross: { state: getGoldenCrossScanStateSync() },
        maAlign: { state: getMaAlignScanStateSync() },
        ma120Near: { state: getMa120NearScanStateSync() },
        lowSlopeFlip: { state: getCandleLowSlopeScanStateSync() },
        bookAccum: { state: getBookAccumulationScanStateSync() },
        bottomCandle: {
          enabled: bottomCandleScanEnabled(),
          running: isBottomCandleManualScanRunning(),
          lastManualScan: getLastBottomCandleManualScanResult(),
          state: getBottomCandleScanStateSync(),
        },
        state: getGoldenCrossScanStateSync(),
      });
    }),
  );

  app.post(
    "/api/golden-cross/scan",
    asyncRoute(async (_req, res) => {
      const { triggerGoldenCrossManualScan } = await import("./golden-cross-poller.js");
      const result = triggerGoldenCrossManualScan();
      if (!result.started) {
        const status =
          result.reason === "disabled"
            ? 503
            : result.reason === "busy"
              ? 409
              : 400;
        res.status(status).json({
          started: false,
          reason: result.reason ?? "failed",
          error:
            result.reason === "disabled"
              ? "골든크로스 탐색이 비활성화되어 있습니다."
              : result.reason === "busy"
                ? "이미 탐색이 진행 중입니다."
                : "탐색을 시작할 수 없습니다.",
        });
        return;
      }
      res.json({ started: true });
    }),
  );

  app.get(
    "/api/bottom-candle/status",
    asyncRoute(async (_req, res) => {
      const { getBottomCandleScanStateSync } = await import("./bottom-candle-scan.js");
      const {
        bottomCandleScanEnabled,
        getLastBottomCandleManualScanResult,
        isBottomCandleManualScanRunning,
      } = await import("./bottom-candle-poller.js");
      res.json({
        enabled: bottomCandleScanEnabled(),
        running: isBottomCandleManualScanRunning(),
        lastManualScan: getLastBottomCandleManualScanResult(),
        bottomCandle: { state: getBottomCandleScanStateSync() },
        state: getBottomCandleScanStateSync(),
      });
    }),
  );

  app.post(
    "/api/bottom-candle/scan",
    asyncRoute(async (_req, res) => {
      const { triggerBottomCandleManualScan } = await import("./bottom-candle-poller.js");
      const result = triggerBottomCandleManualScan();
      if (!result.started) {
        const status =
          result.reason === "disabled"
            ? 503
            : result.reason === "busy"
              ? 409
              : 400;
        res.status(status).json({
          started: false,
          reason: result.reason ?? "failed",
          error:
            result.reason === "disabled"
              ? "바닥 캔들 탐색이 비활성화되어 있습니다."
              : result.reason === "busy"
                ? "이미 탐색이 진행 중입니다."
                : "탐색을 시작할 수 없습니다.",
        });
        return;
      }
      res.json({ started: true });
    }),
  );

  app.get(
    "/api/book-accum/fast-scan/status",
    asyncRoute(async (_req, res) => {
      const {
        bookAccumFastScanEnabled,
        getBookAccumulationFastScanStateSync,
        getLastBookAccumFastScanResult,
        isBookAccumFastScanRunning,
      } = await import("./book-accumulation-fast-poller.js");
      res.json({
        enabled: bookAccumFastScanEnabled(),
        running: isBookAccumFastScanRunning(),
        lastRun: getLastBookAccumFastScanResult(),
        state: getBookAccumulationFastScanStateSync(),
      });
    }),
  );

  app.post(
    "/api/book-accum/fast-scan",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const { triggerBookAccumFastScan } = await import(
        "./book-accumulation-fast-poller.js"
      );
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = triggerBookAccumFastScan({
        mergeVault: body.mergeVault,
      });
      if (!result.started) {
        const status =
          result.reason === "disabled"
            ? 503
            : result.reason === "busy"
              ? 409
              : 400;
        res.status(status).json({
          started: false,
          reason: result.reason ?? "failed",
          error:
            result.reason === "disabled"
              ? "매집봉 고속 스캔이 비활성화되어 있습니다."
              : result.reason === "busy"
                ? "이미 고속 스캔이 진행 중입니다."
                : "스캔을 시작할 수 없습니다.",
        });
        return;
      }
      res.json({ started: true });
    }),
  );

  app.get(
    "/api/golden-cross/history",
    asyncRoute(async (req, res) => {
      const {
        listGoldenCrossHistoryRunsSync,
        listGoldenCrossHistoryDatesSync,
        listGoldenCrossHistorySync,
      } = await import("./golden-cross-history-store.js");
      const scanDate = String(req.query?.date ?? "").trim();
      const runId = String(req.query?.runId ?? "").trim();
      const detail = req.query?.detail === "1" || req.query?.detail === "true";
      if (runId) {
        const entries = listGoldenCrossHistorySync({ limit: 180 }).filter(
          (e) => e.runId === runId,
        );
        res.json({ runId, entries });
        return;
      }
      if (detail && scanDate) {
        res.json({
          scanDate,
          entries: listGoldenCrossHistorySync({ scanDate, limit: 60 }),
        });
        return;
      }
      res.json({
        dates: listGoldenCrossHistoryDatesSync(),
        runs: listGoldenCrossHistoryRunsSync({
          scanDate: scanDate || undefined,
          limit: 30,
        }),
      });
    }),
  );

  app.get(
    "/api/ma-align/history",
    asyncRoute(async (req, res) => {
      const {
        listMaAlignHistoryRunsSync,
        listMaAlignHistoryDatesSync,
        listMaAlignHistorySync,
      } = await import("./ma-align-history-store.js");
      const scanDate = String(req.query?.date ?? "").trim();
      const runId = String(req.query?.runId ?? "").trim();
      const detail = req.query?.detail === "1" || req.query?.detail === "true";
      if (runId) {
        const entries = listMaAlignHistorySync({ limit: 180 }).filter(
          (e) => e.runId === runId,
        );
        res.json({ runId, entries });
        return;
      }
      if (detail && scanDate) {
        res.json({
          scanDate,
          entries: listMaAlignHistorySync({ scanDate, limit: 60 }),
        });
        return;
      }
      res.json({
        dates: listMaAlignHistoryDatesSync(),
        runs: listMaAlignHistoryRunsSync({
          scanDate: scanDate || undefined,
          limit: 30,
        }),
      });
    }),
  );

  app.get(
    "/api/ma120-near/history",
    asyncRoute(async (req, res) => {
      const {
        listMa120NearHistoryRunsSync,
        listMa120NearHistoryDatesSync,
        listMa120NearHistorySync,
      } = await import("./ma120-near-history-store.js");
      const scanDate = String(req.query?.date ?? "").trim();
      const runId = String(req.query?.runId ?? "").trim();
      const detail = req.query?.detail === "1" || req.query?.detail === "true";
      if (runId) {
        const entries = listMa120NearHistorySync({ limit: 180 }).filter(
          (e) => e.runId === runId,
        );
        res.json({ runId, entries });
        return;
      }
      if (detail && scanDate) {
        res.json({
          scanDate,
          entries: listMa120NearHistorySync({ scanDate, limit: 60 }),
        });
        return;
      }
      res.json({
        dates: listMa120NearHistoryDatesSync(),
        runs: listMa120NearHistoryRunsSync({
          scanDate: scanDate || undefined,
          limit: 30,
        }),
      });
    }),
  );

  app.get(
    "/api/stock-search/hot",
    asyncRoute(async (req, res) => {
      try {
        const market = String(req.query.market ?? "kr").toLowerCase();
        if (market !== "kr" && market !== "us") {
          res.status(400).json({
            error: "market은 kr 또는 us 여야 합니다.",
          });
          return;
        }
        res.json(await loadHotStocksByTurnover(market));
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock-search",
    asyncRoute(async (req, res) => {
      try {
        const q = String(req.query.q ?? "").trim();
        const market = String(req.query.market ?? "kr").toLowerCase();
        if (market !== "kr" && market !== "us" && market !== "crypto") {
          res.status(400).json({
            error: "market은 kr, us, crypto 중 하나여야 합니다.",
          });
          return;
        }
        const lite =
          req.query.lite === "1" ||
          req.query.lite === "true" ||
          req.query.lite === "yes";
        const data =
          market === "crypto"
            ? await searchCryptoForLiveTrade(q)
            : await searchStocks(q, market, { lite });
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        if (code === "BAD_QUERY") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/value-invest-return",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      const targetRaw = req.query.targetReturn;
      const yearsRaw = req.query.years;
      const priceRaw = req.query.price;
      const targetReturnRate =
        targetRaw != null && targetRaw !== "" ? Number(targetRaw) : undefined;
      const years = yearsRaw != null && yearsRaw !== "" ? Number(yearsRaw) : undefined;
      const price = priceRaw != null && priceRaw !== "" ? Number(priceRaw) : undefined;
      if (
        targetReturnRate != null &&
        (!Number.isFinite(targetReturnRate) || targetReturnRate < 0 || targetReturnRate > 1)
      ) {
        res.status(400).json({ error: "targetReturn은 0~1 사이여야 합니다." });
        return;
      }
      if (years != null && (!Number.isFinite(years) || years < 1 || years > 30)) {
        res.status(400).json({ error: "years는 1~30 사이어야 합니다." });
        return;
      }
      if (price != null && (!Number.isFinite(price) || price <= 0)) {
        res.status(400).json({ error: "price는 양수여야 합니다." });
        return;
      }
      try {
        const data = await loadValueInvestReturn(req.params.symbol, {
          targetReturnRate,
          years,
          price,
        });
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL" || code === "UNSUPPORTED") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/share-structure",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      const marketRaw = String(req.query.market ?? "").trim().toLowerCase();
      const market =
        marketRaw === "kr" || marketRaw === "us" ? marketRaw : undefined;
      try {
        const data = await loadStockShareStructure(req.params.symbol, market);
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/intrinsic-value",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      const marginRaw = req.query.margin;
      const margin =
        marginRaw != null && marginRaw !== ""
          ? Number(marginRaw)
          : undefined;
      if (margin != null && (!Number.isFinite(margin) || margin < 0 || margin > 0.5)) {
        res.status(400).json({ error: "margin은 0~0.5 사이여야 합니다." });
        return;
      }
      try {
        const data = await loadBuffettIntrinsicValue(req.params.symbol, {
          marginOfSafety: margin,
        });
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL" || code === "UNSUPPORTED" || code === "BAD_QUERY") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/fundamentals",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      try {
        const data = await loadStockFundamentals(req.params.symbol);
        res.json(data);
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "RATE_LIMIT") {
          clearYahooSession();
        }
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL" || code === "UNSUPPORTED") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/financials/periods",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      try {
        const data = await loadFinancialPeriods(req.params.symbol);
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL" || code === "UNSUPPORTED") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/financials/periods/:periodId",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      const periodId = decodeURIComponent(String(req.params.periodId ?? ""));
      if (!periodId) {
        res.status(400).json({ error: "기간 ID가 필요합니다." });
        return;
      }
      try {
        const data = await loadFinancialStatementDetail(req.params.symbol, periodId);
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL" || code === "UNSUPPORTED") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/financials/periods/:periodId/analysis",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      const periodId = decodeURIComponent(String(req.params.periodId ?? ""));
      if (!periodId) {
        res.status(400).json({ error: "기간 ID가 필요합니다." });
        return;
      }
      try {
        const data = await loadFinancialStatementAnalysis(req.params.symbol, periodId);
        res.json(data);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : "";
        const message = err instanceof Error ? err.message : "요청 실패";
        if (code === "BAD_SYMBOL" || code === "UNSUPPORTED") {
          res.status(400).json({ error: message });
          return;
        }
        res.status(code === "NOT_FOUND" ? 404 : 502).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol/technical",
    asyncRoute(async (req, res) => {
      try {
        const symbol = String(req.params.symbol ?? "").trim();
        if (!symbol) {
          res.status(400).json({ error: "symbol이 필요합니다." });
          return;
        }
        const [data, daily] = await Promise.all([
          fetchScanCandles(symbol),
          loadStock(symbol, "1d", { live: false }),
        ]);
        const modelIdQ = String(req.query.modelId ?? "").trim();
        const model = modelIdQ
          ? getTechModelByIdSync(modelIdQ)
          : getActiveTechModelsSync()[0] ??
            getTechModelByIdSync("default");
        const weights = model?.weights;
        const report = buildTechnicalStatusReport(data.candles, weights, {
          dailyMa5OverMa20: detectDailyMa5OverMa20(daily?.candles ?? []),
        });
        res.json({
          symbol: data.symbol,
          techModelId: model?.id ?? "default",
          techModelName: model?.name ?? "기본",
          techModelMaxScore: model
            ? sumTechScoreWeights(model.weights)
            : report.maxScore,
          ...report,
          candleCount:
            report.candleCount ??
            data.candleCount ??
            data.candles?.length ??
            0,
        });
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "RATE_LIMIT") {
          clearYahooSession();
        }
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol",
    asyncRoute(async (req, res) => {
      if (!/^[A-Z0-9.\-^]{1,20}$/i.test(req.params.symbol)) {
        res.status(400).json({ error: "올바르지 않은 심볼 형식입니다." });
        return;
      }
      try {
        const symbol = req.params.symbol.toUpperCase();
        const timeframe = String(req.query.timeframe ?? req.query.period ?? "1d");
        const live = req.query.live === "1" || req.query.live === "true";
        const data = await loadStock(symbol, timeframe, { live });
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "요청한 API를 찾을 수 없습니다.",
      code: "API_NOT_FOUND",
      path: req.originalUrl ?? req.url,
    });
  });

  installDistSpaIfPresent(app);

  const _backfillTimer = setTimeout(() => scheduleRecommendationSignalBackfill(), 5000);

  app.use((err, _req, res, _next) => {
    if (err instanceof StoreCorruptError && !res.headersSent) {
      res.status(503).json({
        error: err.message,
        code: err.code,
        filePath: err.filePath,
      });
      return;
    }
    const message = err instanceof Error ? err.message : "요청 실패";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
