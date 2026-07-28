/**
 * 가상 사용자 API 라우트 등록
 */
import { requireAccessAdmin } from "./route-guards.js";
import {
  backupVirtualFeedbackSync,
  deleteVirtualFeedbackSync,
  getVirtualUserContinuousSync,
  listVirtualBackupsSync,
  listVirtualFeedbackSync,
  listVirtualPersonasSync,
  patchVirtualFeedbackSync,
  patchVirtualUserContinuousSync,
  readVirtualUserStoreSync,
  updateVirtualPersonaSync,
} from "./virtual-user-store.js";
import { runVirtualUserSession } from "./virtual-user-runner.js";
import { notifyVirtualUserFeedback } from "./virtual-user-telegram.js";
import { maybeAutoImplementVirtualFeedback } from "./virtual-user-auto-implement.js";
import {
  isVirtualUserContinuousBusy,
  rescheduleVirtualUserContinuousPoller,
  tickVirtualUserContinuousOnce,
} from "./virtual-user-poller.js";
import { satisfactionLabelKo } from "./virtual-user-satisfaction.js";
import { ensureDefaultPersonasPresentSync } from "./virtual-user-store.js";
import {
  listCodeVersionsSync,
  readCodeVersionStoreSync,
} from "./code-version-store.js";
import { scheduleVirtualUserAdminHydration } from "./virtual-user-admin-hydrate.js";

/**
 * @param {(handler: (req: any, res: any) => Promise<void>) => import("express").RequestHandler} asyncRoute
 * @param {import("express").Express} app
 */
export function registerVirtualUserRoutes(app, asyncRoute) {
  app.get(
    "/api/virtual-users",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      // 목록은 빠르게 읽기만 — enrich/git는 백그라운드 (기존 피드백 유지)
      ensureDefaultPersonasPresentSync();
      scheduleVirtualUserAdminHydration();
      const store = readVirtualUserStoreSync();
      const codeStore = readCodeVersionStoreSync();
      const discomfortCount = store.feedback.filter((f) =>
        String(f.discomfort || f.detail || f.title || "").trim(),
      ).length;
      const waitingCount = store.feedback.filter((f) => f.status === "new").length;
      const runningCount = store.feedback.filter(
        (f) => f.status === "queued",
      ).length;
      const improvedCount = store.feedback.filter(
        (f) =>
          f.status === "done" &&
          String(f.improvementSummary || "").trim() &&
          !String(f.improvementSummary).startsWith("구현 대기") &&
          !String(f.improvementSummary).startsWith("개발 대기"),
      ).length;
      res.json({
        ok: true,
        personas: store.personas,
        feedback: store.feedback,
        sessions: store.sessions.slice(0, 20),
        continuous: store.continuous,
        busy: isVirtualUserContinuousBusy(),
        codeVersions: {
          baselineId: codeStore.baselineId,
          lockedBaselineSha: codeStore.lockedBaselineSha,
          versions: listCodeVersionsSync(),
        },
        narrative: {
          discomfortCount,
          waitingCount,
          runningCount,
          queuedCount: waitingCount,
          improvedCount,
          total: store.feedback.length,
        },
        satisfactionLabels: {
          1: satisfactionLabelKo(1),
          2: satisfactionLabelKo(2),
          3: satisfactionLabelKo(3),
          4: satisfactionLabelKo(4),
          5: satisfactionLabelKo(5),
        },
      });
    }),
  );

  app.get(
    "/api/virtual-users/continuous",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      res.json({
        ok: true,
        continuous: getVirtualUserContinuousSync(),
        busy: isVirtualUserContinuousBusy(),
      });
    }),
  );

  app.patch(
    "/api/virtual-users/continuous",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const body = req.body ?? {};
      /** @type {Record<string, unknown>} */
      const patch = {};
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body.useBrowser !== undefined) patch.useBrowser = Boolean(body.useBrowser);
      if (body.notifyTelegram !== undefined) {
        patch.notifyTelegram = Boolean(body.notifyTelegram);
      }
      if (body.autoImplement !== undefined) {
        patch.autoImplement = Boolean(body.autoImplement);
      }
      if (body.autoImplementMinSeverity !== undefined) {
        const s = String(body.autoImplementMinSeverity);
        if (["blocker", "major", "minor", "nit"].includes(s)) {
          patch.autoImplementMinSeverity = s;
        }
      }
      if (body.intervalMs !== undefined) {
        const n = Number(body.intervalMs);
        if (Number.isFinite(n) && n >= 60_000) {
          patch.intervalMs = Math.min(n, 60 * 60_000);
        }
      }
      // 사용자가 다시 켜면 API 소진 정지 해제
      if (patch.enabled === true || patch.autoImplement === true) {
        patch.pausedByApiExhaustion = false;
        patch.pausedAtMs = null;
        patch.pausedReason = null;
        if (patch.enabled === true && patch.autoImplement === undefined) {
          patch.autoImplement = true;
        }
        if (patch.lastError === undefined) patch.lastError = null;
      }
      const result = patchVirtualUserContinuousSync(patch);
      rescheduleVirtualUserContinuousPoller();
      res.json({ ...result, busy: isVirtualUserContinuousBusy() });
    }),
  );

  app.post(
    "/api/virtual-users/continuous/tick",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      const result = await tickVirtualUserContinuousOnce();
      res.json({
        ok: result?.ok !== false,
        result,
        continuous: getVirtualUserContinuousSync(),
        busy: isVirtualUserContinuousBusy(),
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
        useBrowser: body.useBrowser !== false,
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

      let backup = null;
      try {
        backup = backupVirtualFeedbackSync(id);
      } catch {
        backup = null;
      }

      const auto = await maybeAutoImplementVirtualFeedback(item, { force: true });
      if (!auto.ok) {
        res.status(400).json({
          ok: false,
          error:
            auto.reason === "queue-fail" || auto.reason === "QUEUE_FULL"
              ? "기록 모드 큐가 가득 찼거나 넣을 수 없습니다."
              : auto.reason === "empty-prompt"
                ? "구현용 프롬프트가 비어 있습니다."
                : auto.reason === "already-handled" || auto.reason === "has-job"
                  ? "이미 구현 큐에 있거나 처리된 피드백입니다."
                  : "구현 요청을 큐에 넣지 못했습니다.",
          reason: auto.reason,
          backup,
        });
        return;
      }

      const patched = listVirtualFeedbackSync().find((f) => f.id === id);
      res.json({
        ok: true,
        jobId: auto.jobId,
        item: patched || item,
        backup: backup?.ok ? backup : null,
        preVersion: auto.preVersion || null,
        message:
          "기록 모드 큐에 넣었습니다. Cursor 에이전트가 순차 실행하며, 관리자에서 버전 롤백이 가능합니다.",
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
