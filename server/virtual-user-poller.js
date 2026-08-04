/**
 * 가상 사용자 연속 탐색 폴러
 * - 탐색: 쉬지 않고 연속 (세션 사이 짧은 gap만). IDE 요청이 오면 쉬고, 개발 완료되면 즉시 재개
 * - 연속 탐색에서는 Playwright로 같은 Vite(5173)를 열지 않음(자기 부하시 웹 로딩 불가)
 * - 에이전트 전송: 짧은 주기로 스캔 + 잡 완료 시 즉시 다음 건 (IDE 채팅은 막지 않음)
 */
import { appendServerEventLog } from "./access-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import {
  getVirtualUserContinuousSync,
  patchVirtualUserContinuousSync,
  ensureDefaultPersonasPresentSync,
  listVirtualFeedbackSync,
} from "./virtual-user-store.js";
import { runVirtualUserSession } from "./virtual-user-runner.js";
import {
  ensureVirtualUserAutoImproveOnBoot,
  ensureVirtualUserContinuousAlwaysOn,
  hasCursorApiKey,
  pauseVirtualUserForApiExhaustion,
} from "./virtual-user-api-guard.js";
import { enrichVirtualFeedbackNarrativesSync } from "./virtual-user-feedback-enrich.js";
import { dispatchNextVirtualUserImplement } from "./virtual-user-auto-implement.js";
import { reviewPendingVirtualFeedbackBatchSync } from "./virtual-user-manager.js";
import {
  isIdeDevBusySync,
  isServerDevelopingSync,
} from "./virtual-user-dev-gate.js";

const POLLER_ID = "virtual-user-continuous";
/** 에이전트 전송 스캔 주기(안전망) — 정상 시 잡 완료 직후 chain dispatch */
const IMPLEMENT_SCAN_MS = 30_000;
/** 매니저 검토 스캔 (프롬프트 게이트) */
const MANAGER_SCAN_MS = 20_000;
/** 백엔드 전용 연속 탐색 세션 간격 — IDE 없을 때 거의 연속 */
const EXPLORE_GAP_MS = 2_000;
/** IDE 개발 중 탐색 재개 여부 폴링 */
const EXPLORE_IDE_PAUSE_POLL_MS = 3_000;
/** pending 백로그가 이보다 크면 탐색 세션당 분량만 줄임(간격은 유지) */
const EXPLORE_BACKLOG_SOFT = 40;
const EXPLORE_BACKLOG_HARD = 120;

let started = false;
let running = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let exploreTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let implementTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let managerTimer = null;
let lastExploreIdePauseLogMs = 0;

export function getVirtualUserContinuousPollIntervalMs() {
  return IMPLEMENT_SCAN_MS;
}

export function isVirtualUserContinuousBusy() {
  return running;
}

export { isServerDevelopingSync, isIdeDevBusySync } from "./virtual-user-dev-gate.js";

function countFeedbackBacklog() {
  try {
    const list = listVirtualFeedbackSync();
    let pending = 0;
    let approved = 0;
    for (const f of list) {
      if (f.status === "pending_review" || f.status === "new") pending += 1;
      else if (f.status === "approved") approved += 1;
    }
    return { pending, approved, total: list.length };
  } catch {
    return { pending: 0, approved: 0, total: 0 };
  }
}

export async function tickVirtualUserContinuousOnce() {
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync(POLLER_ID, async () => {
    const cfg = getVirtualUserContinuousSync();
    if (!cfg.enabled) return { ok: false, reason: "disabled" };

    // IDE 요청 중에는 탐색 쉼 — 개발 완료 후 kick/폴링으로 재개
    if (isIdeDevBusySync()) {
      const now = Date.now();
      if (now - lastExploreIdePauseLogMs > 30_000) {
        lastExploreIdePauseLogMs = now;
        appendServerEventLog(
          "virtual-user",
          "explore pause — IDE developing (resume when IDE done)",
        );
      }
      return { ok: true, createdCount: 0, pausedForIde: true };
    }

    const backlog = countFeedbackBacklog();
    if (backlog.pending >= EXPLORE_BACKLOG_HARD) {
      // 매니저가 비울 수 있게 검토만 — 간격은 짧게 유지해 “쉬는” 느낌이 안 나게
      tickManagerReviewOnce();
      patchVirtualUserContinuousSync({
        lastTickAtMs: Date.now(),
        lastError: null,
        lastCreatedCount: 0,
        emptyExploreStreak: Math.max(0, Number(cfg.emptyExploreStreak) || 0) + 1,
      });
      appendServerEventLog(
        "virtual-user",
        `explore light tick backlog pending=${backlog.pending} approved=${backlog.approved} (manager drain)`,
      );
      return { ok: true, createdCount: 0, pausedForBacklog: true };
    }

    if (cfg.autoImplement !== false && !hasCursorApiKey()) {
      pauseVirtualUserForApiExhaustion(
        "CURSOR_API_KEY 없음 — 에이전트 구현만 정지(피드백 탐색은 계속).",
      );
    }

    running = true;
    try {
      const personaOffset = Math.max(0, Math.floor(Number(cfg.nextPersonaIndex) || 0));
      const angleOffset = Math.max(
        0,
        Math.floor(Number(cfg.noveltyAngleOffset) || 0),
      );
      // 연속 모드: 브라우저로 동일 origin(5173) 로드 금지 — Vite 이벤트 루프 기아 방지
      const result = await runVirtualUserSession({
        notifyTelegram: cfg.notifyTelegram === true,
        useBrowser: false,
        continuous: true,
        maxPerPersona: backlog.pending >= EXPLORE_BACKLOG_SOFT ? 2 : 5,
        personaOffset,
        maxPersonasPerTick: backlog.pending >= EXPLORE_BACKLOG_SOFT ? 1 : 2,
        noveltyAngleOffset: angleOffset,
      });
      const created = Number(result.createdCount) || 0;
      const emptyStreak =
        created > 0 ? 0 : Math.max(0, Number(cfg.emptyExploreStreak) || 0) + 1;
      patchVirtualUserContinuousSync({
        lastTickAtMs: Date.now(),
        lastSessionId: result.sessionId || null,
        lastError: result.ok ? null : String(result.error || "실패"),
        lastCreatedCount: created,
        nextPersonaIndex: personaOffset + 2,
        noveltyAngleOffset: angleOffset + 1 + emptyStreak,
        emptyExploreStreak: emptyStreak,
      });
      if (result.ok) {
        appendServerEventLog(
          "virtual-user",
          `explore tick ok created=${created} emptyStreak=${emptyStreak} personaOff=${personaOffset} angle=${angleOffset}`,
        );
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchVirtualUserContinuousSync({
        lastTickAtMs: Date.now(),
        lastError: msg,
      });
      appendServerEventLog("virtual-user", `explore tick fail ${msg}`);
      return { ok: false, error: msg };
    } finally {
      running = false;
    }
  });
}

/**
 * IDE 개발 완료·해제 직후 탐색 즉시 재개.
 * @param {number} [delayMs]
 */
export function kickVirtualUserExploreSoon(delayMs = 0) {
  if (!started) return;
  scheduleExploreSoon(Math.max(0, Number(delayMs) || 0));
}

function scheduleExploreSoon(delayMs = EXPLORE_GAP_MS) {
  if (exploreTimer) {
    clearTimeout(exploreTimer);
    exploreTimer = null;
  }
  if (!started) return;
  exploreTimer = setTimeout(() => {
    exploreTimer = null;
    void (async () => {
      ensureVirtualUserContinuousAlwaysOn();
      const cfg = getVirtualUserContinuousSync();
      if (!cfg.enabled) {
        scheduleExploreSoon(5_000);
        return;
      }
      if (isIdeDevBusySync()) {
        const now = Date.now();
        if (now - lastExploreIdePauseLogMs > 30_000) {
          lastExploreIdePauseLogMs = now;
          appendServerEventLog(
            "virtual-user",
            "explore pause — IDE developing (resume when IDE done)",
          );
        }
        scheduleExploreSoon(EXPLORE_IDE_PAUSE_POLL_MS);
        return;
      }
      try {
        await tickVirtualUserContinuousOnce();
      } catch {
        /* continue loop */
      }
      // IDE가 없으면 백로그와 무관하게 거의 연속 탐색
      const nextGap = isIdeDevBusySync()
        ? EXPLORE_IDE_PAUSE_POLL_MS
        : EXPLORE_GAP_MS;
      scheduleExploreSoon(nextGap);
    })();
  }, delayMs);
}

/**
 * 매니저: pending_review/new 프롬프트 검토 → approved 또는 dismissed
 */
function tickManagerReviewOnce() {
  try {
    const { pending } = countFeedbackBacklog();
    const limit = pending >= EXPLORE_BACKLOG_SOFT ? 20 : 8;
    const r = reviewPendingVirtualFeedbackBatchSync({ limit });
    if (r.reviewed > 0) {
      appendServerEventLog(
        "virtual-user-manager",
        `batch reviewed=${r.reviewed}`,
      );
    }
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendServerEventLog("virtual-user-manager", `batch fail ${msg}`);
    return { ok: false, reviewed: 0, error: msg };
  }
}

/**
 * 주기 스캔: 웹/기록모드 개발 중이 아니면 대기 피드백 1건만 에이전트로
 */
async function tickImplementScanOnce() {
  tickManagerReviewOnce();
  if (isServerDevelopingSync()) {
    appendServerEventLog(
      "virtual-user",
      "implement scan skip — server developing",
    );
    return { ok: false, reason: "developing" };
  }
  const cfg = getVirtualUserContinuousSync();
  if (cfg.enabled === false) {
    return { ok: false, reason: "disabled" };
  }
  if (cfg.pausedByApiExhaustion) {
    return { ok: false, reason: "api-exhausted" };
  }
  if (cfg.autoImplement === false) {
    return { ok: false, reason: "auto-off" };
  }
  const r = await dispatchNextVirtualUserImplement();
  if (!r?.ok && r?.reason && r.reason !== "none") {
    appendServerEventLog(
      "virtual-user",
      `implement scan skip — ${r.reason}`,
    );
  }
  return r;
}

export function startVirtualUserContinuousPoller() {
  if (process.env.STOCK_VIRTUAL_USER_CONTINUOUS === "0") {
    appendServerEventLog(
      "virtual-user",
      "continuous poller off (STOCK_VIRTUAL_USER_CONTINUOUS=0)",
    );
    return;
  }
  if (started) return;
  started = true;

  const boot = ensureVirtualUserAutoImproveOnBoot();
  try {
    const personas = ensureDefaultPersonasPresentSync();
    if (personas.added.length) {
      appendServerEventLog(
        "virtual-user",
        `personas added ${personas.added.join(",")}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendServerEventLog("virtual-user", `personas ensure fail ${msg}`);
  }
  try {
    const enriched = enrichVirtualFeedbackNarrativesSync();
    appendServerEventLog(
      "virtual-user",
      `narrative enrich updated=${enriched.updated}/${enriched.total}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendServerEventLog("virtual-user", `narrative enrich fail ${msg}`);
  }

  patchVirtualUserContinuousSync({
    intervalMs: IMPLEMENT_SCAN_MS,
  });
  ensureVirtualUserAutoImproveOnBoot();
  const after = getVirtualUserContinuousSync();
  appendServerEventLog(
    "virtual-user",
    `explore=always-on gap=${EXPLORE_GAP_MS}ms · pauseOnIde=1 · implementScan=${after.intervalMs}ms enabled=${after.enabled} autoImplement=${after.autoImplement} boot=${boot.reason || "ok"}`,
  );
  markPollerBootStarted(POLLER_ID);

  scheduleExploreSoon(5_000);

  if (managerTimer) clearInterval(managerTimer);
  managerTimer = setInterval(() => {
    tickManagerReviewOnce();
  }, MANAGER_SCAN_MS);
  setTimeout(() => tickManagerReviewOnce(), 12_000);

  if (implementTimer) clearInterval(implementTimer);
  implementTimer = setInterval(() => {
    void tickImplementScanOnce().catch(() => {});
  }, IMPLEMENT_SCAN_MS);
  setTimeout(() => {
    void tickImplementScanOnce().catch(() => {});
  }, 5_000);
}

/** 관리 UI에서 enabled 바뀐 뒤 탐색 루프 유지 */
export function rescheduleVirtualUserContinuousPoller() {
  if (!started) return;
  const cfg = getVirtualUserContinuousSync();
  if (cfg.enabled && !exploreTimer && !running) {
    scheduleExploreSoon(EXPLORE_GAP_MS);
  }
}
