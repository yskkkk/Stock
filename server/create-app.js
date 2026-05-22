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
} from "./access-control.js";
import { appendServerEventLog, expressAccessLogger, clientIp as expressClientIp } from "./access-log.js";
import { isDartEnabled } from "./dart.js";
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
import { analyzeTechnicals } from "./technical.js";
import { clearYahooSession } from "./yahoo.js";
import { getUsdKrwRate } from "./fx-usd-krw.js";
import { searchStocks } from "./stock-search.js";
import { getMacroEventsCachedAsync } from "./macro-events.js";
import { fetchSectorEarningsSpotlight } from "./sector-earnings-spotlight.js";
import { postFeedback, getFeedbackInbox, postFeedbackAdminReply, deleteFeedbackAdmin } from "./feedback-inbox.js";
import { runOpsCursorAgent, streamOpsCursorAgentSse, writeOpsAgentSseEvent } from "./cursor-ops-agent.js";
import {
  abandonIdeDevQueueSlot,
  acquireIdeDevQueueSlot,
  enqueueOpsAgentJob,
  registerIdeDevQueueSlot,
  releaseAnyRunningIdeDevQueueSlot,
  releaseIdeDevQueueSlot,
  waitIdeDevQueueGrant,
} from "./ops-agent-job-queue.js";
import { clearIdeLeaseOnDisk } from "./ops-ide-lease-disk.js";
import {
  clearOpsAgentHistoryAsync,
  prependPolicyRejectedOpsEntry,
  readOpsAgentHistorySync,
  removeOpsAgentHistoryEntryById,
  setOpsHistoryWorkspaceApplied,
} from "./ops-agent-history-store.js";
import { checkOpsInstructionPolicy } from "./ops-agent-instruction-policy.js";
import { getOpsAgentPendingForIp } from "./ops-agent-pending-store.js";
import { triggerOpsStreamUserCancel } from "./ops-stream-cancel.js";
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
} from "./picks-recommendations-tracker.js";
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
  resetDefaultTechModelWeightsSync,
  setActiveTechModelIdsSync,
  updateTechModelSync,
} from "./picks-tech-models-store.js";
import {
  armLiveTradeProgramSync,
  createLiveTradeProgramSync,
  deleteLiveTradeProgramSync,
  disarmLiveTradeProgramSync,
  listLiveTradeProgramsSync,
  startSimLiveTradeProgramSync,
  stopSimLiveTradeProgramSync,
  updateLiveTradeProgramSync,
} from "./live-trade-programs-store.js";
import { startLiveTradeAutoSellPoller } from "./live-trade-auto-sell.js";
import {
  buildLiveTradePortfolioSnapshot,
  recordLiveTradeSimBuyAsync,
  recordLiveTradeSimSellAsync,
  recordLiveTradeSellSync,
} from "./live-trade-portfolio-store.js";
import { getTossTradingStatus } from "./toss-trading-adapter.js";
import {
  fetchQuoteSnapshotsForSymbols,
  mergeLiveQuotesIntoPicksState,
} from "./picks-live-quotes.js";
import { enrichUnifiedQueueAgentAndRecord } from "./ops-unified-queue-seq.js";
import { readDevQueueDisplaySnapshotSync } from "./ops-dev-queue-live-store.js";
import { startDevQueueDisplaySyncPoller } from "./ops-dev-queue-display-sync.js";
import {
  FILE_DEV_POLL_MS,
  appendFileDevPendingJob,
  mergeFileDevQueueFromClient,
  readFileDevQueueSync,
} from "./ops-file-dev-store.js";
import { startOpsFileDevPoller } from "./ops-file-dev-poller.js";

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
      return next();
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

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {{ code: string; messageKo: string }} bad
   */
  async function respondInstructionPolicyBlock(req, res, bad) {
    const rip = normalizeAccessIp(expressClientIp(req));
    const rejectedId = randomUUID();
    try {
      await prependPolicyRejectedOpsEntry({
        id: rejectedId,
        requestIp: rip,
        policyCode: bad.code,
        userMessage: bad.messageKo,
      });
    } catch {
      /* 디스크 오류 등 */
    }
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

  app.get(
    "/api/picks",
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

  app.get("/api/picks/daily-history", (_req, res) => {
    res.json(getPicksDailyHistoryForApi());
  });

  app.get(
    "/api/picks/daily-history/quotes",
    asyncRoute(async (req, res) => {
      const raw = String(req.query.symbols ?? "").trim();
      const symbols = raw
        ? raw
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const quotes = await fetchQuoteSnapshotsForSymbols(symbols);
      res.json({ quotes });
    }),
  );

  app.get(
    "/api/picks/recommendations-tracker",
    asyncRoute(async (req, res) => {
      const includeQuotes = String(req.query.quotes ?? "1").trim() !== "0";
      res.json(await buildRecommendationsTrackerPayload({ includeQuotes }));
    }),
  );

  app.get("/api/picks/tech-weights", (_req, res) => {
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

  app.post("/api/picks/tech-weights/reset", (_req, res) => {
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

  app.get("/api/picks/tech-models", (_req, res) => {
    res.json(listTechModelsSync());
  });

  app.post(
    "/api/picks/tech-models",
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

  app.get("/api/live-trading/status", (_req, res) => {
    const toss = getTossTradingStatus();
    const programs = listLiveTradeProgramsSync();
    res.json({
      toss,
      programs,
      armedCount: programs.filter((p) => p.status === "armed").length,
      simCount: programs.filter((p) => p.status === "sim").length,
      simulatedOrders: process.env.TOSS_LIVE_ORDERS_ENABLED !== "1",
    });
  });

  app.post(
    "/api/live-trading/programs",
    asyncRoute(async (req, res) => {
      try {
        const program = createLiveTradeProgramSync({
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
        });
        res.json({ ok: true, program, programs: listLiveTradeProgramsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.patch(
    "/api/live-trading/programs/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const program = updateLiveTradeProgramSync(id, {
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
        });
        res.json({ ok: true, program, programs: listLiveTradeProgramsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.delete(
    "/api/live-trading/programs/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        deleteLiveTradeProgramSync(id);
        res.json({ ok: true, programs: listLiveTradeProgramsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/arm",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const toss = getTossTradingStatus();
        const program = armLiveTradeProgramSync(id, {
          tossConfigured: toss.configured,
          tossMessage: toss.messageKo,
        });
        res.json({ ok: true, program, toss });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/disarm",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const program = disarmLiveTradeProgramSync(id);
        res.json({ ok: true, program });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/sim-start",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const program = startSimLiveTradeProgramSync(id);
        res.json({ ok: true, program, programs: listLiveTradeProgramsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/programs/:id/sim-stop",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      try {
        const program = stopSimLiveTradeProgramSync(id);
        res.json({ ok: true, program, programs: listLiveTradeProgramsSync() });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.get(
    "/api/live-trading/portfolio",
    asyncRoute(async (req, res) => {
      const programId = String(req.query?.programId ?? "").trim() || null;
      const snap = await buildLiveTradePortfolioSnapshot({ programId });
      const programs = listLiveTradeProgramsSync();
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
    "/api/live-trading/trades/sell",
    asyncRoute(async (req, res) => {
      try {
        const trade = recordLiveTradeSellSync({
          programId: String(req.body?.programId ?? ""),
          symbol: String(req.body?.symbol ?? ""),
          market: req.body?.market,
          quantity: req.body?.quantity,
          price: Number(req.body?.price),
          note: req.body?.note,
          simulated: Boolean(req.body?.simulated),
          atMs: req.body?.atMs,
        });
        const snap = await buildLiveTradePortfolioSnapshot({
          programId: trade.programId,
        });
        res.json({ ok: true, trade, portfolio: snap });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  app.post(
    "/api/live-trading/simulate/buy",
    asyncRoute(async (req, res) => {
      try {
        const { trade, quote } = await recordLiveTradeSimBuyAsync({
          programId: String(req.body?.programId ?? ""),
          symbol: String(req.body?.symbol ?? ""),
          market: req.body?.market,
          name: req.body?.name,
        });
        const snap = await buildLiveTradePortfolioSnapshot({
          programId: trade.programId,
        });
        const programs = listLiveTradeProgramsSync();
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
    asyncRoute(async (req, res) => {
      try {
        const { trade, quote } = await recordLiveTradeSimSellAsync({
          programId: String(req.body?.programId ?? ""),
          symbol: String(req.body?.symbol ?? ""),
          market: req.body?.market,
          quantity: req.body?.quantity,
          note: req.body?.note,
        });
        const snap = await buildLiveTradePortfolioSnapshot({
          programId: trade.programId,
        });
        const programs = listLiveTradeProgramsSync();
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

  app.post("/api/picks/refresh", (_req, res) => {
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
    "/api/ops/dev-queue/ide/release-active",
    asyncRoute(async (req, res) => {
      if (!isLoopbackDevQueueRequest(req)) {
        res.status(403).json({
          error: "IDE 개발 큐는 이 PC의 로컬 요청(loopback)에서만 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const out = releaseAnyRunningIdeDevQueueSlot();
      clearIdeLeaseOnDisk();
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
    asyncRoute(async (req, res) => {
      const snap = readDevQueueDisplaySnapshotSync();
      const viewerIp = isAccessAdminRequest(req)
        ? normalizeAccessIp(expressClientIp(req)) || null
        : null;
      res.json({
        ...snap,
        viewerIp,
      });
    }),
  );

  app.get(
    "/api/ops/cursor-agent-history",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      res.json({ entries: readOpsAgentHistorySync() });
    }),
  );

  app.delete(
    "/api/ops/cursor-agent-history/:id",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const id = String(req.params?.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id가 필요합니다." });
        return;
      }
      await removeOpsAgentHistoryEntryById(id);
      triggerOpsStreamUserCancel(id);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/ops/cursor-agent-history/:id/workspace-applied",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const id = String(req.params?.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id가 필요합니다." });
        return;
      }
      const raw = req.body?.applied;
      const applied = raw === true || raw === 1 || raw === "1" || raw === "true";
      const cleared =
        raw === false || raw === 0 || raw === "0" || raw === "false" || raw === null;
      if (!applied && !cleared) {
        res.status(400).json({ error: "body에 applied: true 또는 false가 필요합니다." });
        return;
      }
      const ok = await setOpsHistoryWorkspaceApplied(id, applied);
      if (!ok) {
        res.status(404).json({ error: "해당 이력이 없거나 실행 중이라 표시를 바꿀 수 없습니다." });
        return;
      }
      res.json({ ok: true, entries: readOpsAgentHistorySync() });
    }),
  );

  app.delete(
    "/api/ops/cursor-agent-history",
    asyncRoute(async (req, res) => {
      if (!isAccessAdminRequest(req)) {
        res.status(403).json({
          error: "관리자만 Cursor 에이전트 연동을 사용할 수 있습니다.",
          code: "FORBIDDEN",
        });
        return;
      }
      const snapshot = readOpsAgentHistorySync();
      for (const e of snapshot) {
        if (e.state === "running") triggerOpsStreamUserCancel(e.id);
      }
      await clearOpsAgentHistoryAsync();
      res.json({ ok: true });
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

  app.get("/api/feedback/inbox", (req, res) => {
    getFeedbackInbox(req, res);
  });

  app.post("/api/feedback/admin/reply", (req, res) => {
    postFeedbackAdminReply(req, res);
  });

  app.post("/api/feedback/admin/delete", (req, res) => {
    deleteFeedbackAdmin(req, res);
  });

  app.get("/api/telegram/sent", (_req, res) => {
    if (!isTelegramNotifyEnabled()) {
      res.status(400).json({
        error: "텔레그램 알림이 설정되지 않았습니다.",
      });
      return;
    }
    const items = listTodayTelegramSent();
    const pickBySymbol = new Map();
    for (const p of [...getPicksState().kr, ...getPicksState().us]) {
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
    "/api/stock-search",
    asyncRoute(async (req, res) => {
      try {
        const q = String(req.query.q ?? "").trim();
        const market = String(req.query.market ?? "kr").toLowerCase();
        if (market !== "kr" && market !== "us") {
          res.status(400).json({ error: "market은 kr 또는 us여야 합니다." });
          return;
        }
        const data = await searchStocks(q, market);
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
    "/api/stock/:symbol/technical",
    asyncRoute(async (req, res) => {
      try {
        const symbol = String(req.params.symbol ?? "").trim();
        if (!symbol) {
          res.status(400).json({ error: "symbol이 필요합니다." });
          return;
        }
        const data = await fetchScanCandles(symbol);
        const analysis = analyzeTechnicals(data.candles);
        res.json({
          symbol: data.symbol,
          score: analysis.score,
          signalIds: analysis.signalIds,
          signals: analysis.signals,
          buy: analysis.buy,
          candleCount: data.candleCount ?? data.candles?.length ?? 0,
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

  installDistSpaIfPresent(app);

  try {
    startDevQueueDisplaySyncPoller();
    startLiveTradeAutoSellPoller();
  } catch {
    /* ignore */
  }
  startOpsFileDevPoller();
  setTimeout(() => scheduleRecommendationSignalBackfill(), 5000);

  app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "요청 실패";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
