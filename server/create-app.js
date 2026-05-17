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
import { expressAccessLogger, clientIp as expressClientIp } from "./access-log.js";
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
import { loadStock } from "./stock-data.js";
import { getUsdKrwRate } from "./fx-usd-krw.js";
import { searchStocks } from "./stock-search.js";
import { getMacroEventsCached } from "./macro-events.js";
import { postFeedback, getFeedbackInbox, postFeedbackAdminReply, deleteFeedbackAdmin } from "./feedback-inbox.js";
import { runOpsCursorAgent, streamOpsCursorAgentSse, writeOpsAgentSseEvent } from "./cursor-ops-agent.js";
import { enqueueOpsAgentJob, getOpsAgentQueueSnapshot } from "./ops-agent-job-queue.js";
import {
  clearOpsAgentHistoryAsync,
  prependQueuedOpsEntrySync,
  readOpsAgentHistorySync,
  removeOpsAgentHistoryEntryById,
} from "./ops-agent-history-store.js";
import { getOpsAgentPendingForIp } from "./ops-agent-pending-store.js";
import { triggerOpsStreamUserCancel } from "./ops-stream-cancel.js";

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

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(expressAccessLogger);
  app.use(express.json());
  registerAccessControl(app);

  app.get("/api/picks", (req, res) => {
    ensureScreening();
    res.json(getPicksState());
  });

  app.post("/api/picks/refresh", (_req, res) => {
    res.json(forceRescreen());
  });

  app.get("/api/macro-events", (_req, res) => {
    res.json(getMacroEventsCached());
  });

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
          { requestIp: rip, instruction },
          () => {
            try {
              prependQueuedOpsEntrySync(historyRunId, instruction, rip);
            } catch {
              /* 디스크 오류 — 실행 시작 시 running 레코드로 보완 */
            }
          },
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
      res.json({
        ...getOpsAgentQueueSnapshot(),
        viewerIp: viewerIp || null,
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
        price: item.price ?? pick.price ?? null,
        changePercent: item.changePercent ?? pick.changePercent ?? null,
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

  app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "요청 실패";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
