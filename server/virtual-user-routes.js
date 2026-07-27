/**
 * 가상 사용자 API 라우트 등록
 */
import { requireAccessAdmin } from "./route-guards.js";
import {
  backupVirtualFeedbackSync,
  deleteVirtualFeedbackSync,
  listVirtualBackupsSync,
  listVirtualFeedbackSync,
  listVirtualPersonasSync,
  patchVirtualFeedbackSync,
  readVirtualUserStoreSync,
  updateVirtualPersonaSync,
} from "./virtual-user-store.js";
import { runVirtualUserSession } from "./virtual-user-runner.js";
import { appendRecordModePendingJob } from "./ops-record-mode-store.js";
import { notifyVirtualUserFeedback } from "./virtual-user-telegram.js";

/**
 * @param {(handler: (req: any, res: any) => Promise<void>) => import("express").RequestHandler} asyncRoute
 * @param {import("express").Express} app
 */
export function registerVirtualUserRoutes(app, asyncRoute) {
  app.get(
    "/api/virtual-users",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      const store = readVirtualUserStoreSync();
      res.json({
        ok: true,
        personas: store.personas,
        feedback: store.feedback,
        sessions: store.sessions.slice(0, 20),
      });
    }),
  );

  app.get(
    "/api/virtual-users/personas",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      res.json({ ok: true, personas: listVirtualPersonasSync() });
    }),
  );

  app.patch(
    "/api/virtual-users/personas/:id",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const body = req.body ?? {};
      /** @type {Record<string, unknown>} */
      const patch = {};
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.name !== undefined) patch.name = body.name;
      if (body.traits !== undefined) patch.traits = body.traits;
      if (body.goals !== undefined) patch.goals = body.goals;
      if (body.focusAreas !== undefined) patch.focusAreas = body.focusAreas;
      if (body.skill !== undefined) patch.skill = body.skill;
      if (body.device !== undefined) patch.device = body.device;
      const result = updateVirtualPersonaSync(id, patch);
      if (!result.ok) {
        res.status(404).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.get(
    "/api/virtual-users/feedback",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      res.json({ ok: true, feedback: listVirtualFeedbackSync() });
    }),
  );

  app.post(
    "/api/virtual-users/run",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const body = req.body ?? {};
      const result = await runVirtualUserSession({
        personaId: body.personaId ? String(body.personaId) : undefined,
        maxPerPersona: body.maxPerPersona,
        notifyTelegram: body.notifyTelegram !== false,
      });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.post(
    "/api/virtual-users/feedback/:id/implement",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const item = listVirtualFeedbackSync().find((f) => f.id === id);
      if (!item) {
        res.status(404).json({ ok: false, error: "피드백을 찾을 수 없습니다." });
        return;
      }
      const prompt = String(item.prompt ?? "").trim();
      if (!prompt || prompt === "(생성 중)") {
        res.status(400).json({ ok: false, error: "구현용 프롬프트가 비어 있습니다." });
        return;
      }

      let backup = null;
      try {
        backup = backupVirtualFeedbackSync(id);
      } catch {
        backup = null;
      }

      const queued = await appendRecordModePendingJob(prompt);
      if (!queued.ok) {
        res.status(400).json({
          ok: false,
          error:
            queued.code === "QUEUE_FULL"
              ? "기록 모드 큐가 가득 찼습니다."
              : "구현 요청을 큐에 넣지 못했습니다.",
          code: queued.code,
          backup,
        });
        return;
      }

      const patched = patchVirtualFeedbackSync(id, {
        status: "queued",
        implementJobId: queued.id,
        implementQueuedAtMs: Date.now(),
      });

      res.json({
        ok: true,
        jobId: queued.id,
        item: patched.ok ? patched.item : item,
        backup: backup?.ok ? backup : null,
        message: "기록 모드 큐에 넣었습니다. Cursor 에이전트가 순차 실행합니다.",
      });
    }),
  );

  app.post(
    "/api/virtual-users/feedback/:id/backup",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const result = backupVirtualFeedbackSync(id);
      if (!result.ok) {
        res.status(404).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.post(
    "/api/virtual-users/feedback/:id/status",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const status = String(req.body?.status ?? "").trim();
      if (!["new", "queued", "done", "dismissed"].includes(status)) {
        res.status(400).json({ ok: false, error: "잘못된 status 입니다." });
        return;
      }
      const patched = patchVirtualFeedbackSync(id, {
        status: /** @type {"new"|"queued"|"done"|"dismissed"} */ (status),
      });
      if (!patched.ok) {
        res.status(404).json(patched);
        return;
      }
      res.json(patched);
    }),
  );

  app.delete(
    "/api/virtual-users/feedback/:id",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const result = deleteVirtualFeedbackSync(id);
      if (!result.ok) {
        res.status(404).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.get(
    "/api/virtual-users/backups",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const feedbackId = req.query?.feedbackId
        ? String(req.query.feedbackId)
        : undefined;
      res.json({ ok: true, backups: listVirtualBackupsSync(feedbackId) });
    }),
  );

  app.post(
    "/api/virtual-users/feedback/:id/notify-telegram",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      const item = listVirtualFeedbackSync().find((f) => f.id === id);
      if (!item) {
        res.status(404).json({ ok: false, error: "피드백을 찾을 수 없습니다." });
        return;
      }
      const tg = await notifyVirtualUserFeedback(item);
      if (tg.ok && tg.sentAtMs) {
        patchVirtualFeedbackSync(id, { telegramSentAtMs: tg.sentAtMs });
      }
      res.json(tg);
    }),
  );
}
