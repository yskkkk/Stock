/**
 * 가상 사용자 연속 탐색 폴러
 * - 탐색: 세션 끝나면 짧게 쉬고 바로 다음 — 피드백은 대기 없이 계속 쌓임
 * - 연속 탐색에서는 Playwright로 같은 Vite(5173)를 열지 않음(자기 부하시 웹 로딩 불가)
 * - 에이전트 전송: 3분마다 스캔, 서버가 개발 중(에이전트 실행 중)이 아닐 때만 1건 FIFO
 * - 에이전트 1건 제한 이유: ops 큐·워킹트리 동시 수정 충돌 방지
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
  getOpsAgentQueueMemorySnapshot,
  isOpsAgentJobRunning,
} from "./ops-agent-job-queue.js";

const POLLER_ID = "virtual-user-continuous";
/** 에이전트 전송 스캔 주기 */
const IMPLEMENT_SCAN_MS = 3 * 60_000;
/** 매니저 검토 스캔 (프롬프트 게이트) */
const MANAGER_SCAN_MS = 20_000;
/** 백엔드 전용 연속 탐색 세션 간격 */
const EXPLORE_GAP_MS = 5_000;
/** pending 백로그가 이보다 크면 탐색 속도 완화 */
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

export function getVirtualUserContinuousPollIntervalMs() {
  return IMPLEMENT_SCAN_MS;
}

export function isVirtualUserContinuousBusy() {
  return running;
}

/**
 * 웹/기록모드 에이전트가 돌 때만 VU 구현을 막는다.
 * IDE 큐(이 채팅)가 잡혀 있으면 예전엔 수시간 스킵돼 VU가 멈춘 것처럼 보였음.
 */
export function isServerDevelopingSync() {
  try {
    if (!isOpsAgentJobRunning()) return false;
    const entries = getOpsAgentQueueMemorySnapshot()?.entries ?? [];
    const runningEntry = entries.find((e) => e.status === "running");
    if (!runningEntry) return true;
    if (runningEntry.source === "ide" || runningEntry.requestIp === "cursor-ide") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

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

function exploreGapForBacklog() {
  const { pending, approved } = countFeedbackBacklog();
  if (pending >= EXPLORE_BACKLOG_HARD || approved >= 25) {
    return 60_000;
  }
  if (pending >= EXPLORE_BACKLOG_SOFT || approved >= 8) {
    return 20_000;
  }
  return EXPLORE_GAP_MS;
}

export async function tickVirtualUserContinuousOnce() {
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync(POLLER_ID, async () => {
    const cfg = getVirtualUserContinuousSync();
    if (!cfg.enabled) return { ok: false, reason: "disabled" };

    const backlog = countFeedbackBacklog();
    if (backlog.pending >= EXPLORE_BACKLOG_HARD) {
      // 매니저·구현이 따라잡을 때까지 탐색만 잠시 쉼 (상시가동 유지)
      tickManagerReviewOnce();
      patchVirtualUserContinuousSync({
        lastTickAtMs: Date.now(),
        lastError: null,
        lastCreatedCount: 0,
        emptyExploreStreak: Math.max(0, Number(cfg.emptyExploreStreak) || 0) + 1,
      });
      appendServerEventLog(
        "virtual-user",
        `explore pause backlog pending=${backlog.pending} approved=${backlog.approved} (drain first)`,
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
          `explore tick ok created=${created} emptyStreak=${emptyStreak} personaOff=${personaOffset} angle=${angleOffset} (novelty; agent via 3min idle scan)`,
        );
      }
      // 탐색 직후 에이전트 전송하지 않음 — 3분 스캔 + 개발 중 아님일 때만
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

function scheduleExploreSoon(delayMs = EXPLORE_GAP_MS) {
  if (exploreTimer) {
    clearTimeout(exploreTimer);
    exploreTimer = null;
  }
  if (!started) return;
  exploreTimer = setTimeout(() => {
    exploreTimer = null;
    void (async () => {
      // 상시가동: 꺼져 있으면 다시 켠다 (env=0만 완전 off)
      ensureVirtualUserContinuousAlwaysOn();
      const cfg = getVirtualUserContinuousSync();
      if (!cfg.enabled) {
        scheduleExploreSoon(5_000);
        return;
      }
      try {
        await tickVirtualUserContinuousOnce();
      } catch {
        /* continue loop */
      }
      scheduleExploreSoon(exploreGapForBacklog());
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
 * 3분마다: 개발 중이 아니면 대기 피드백 1건만 에이전트로
 */
async function tickImplementScanOnce() {
  // 전송 직전 미검토 분량 선처리
  tickManagerReviewOnce();
  if (isServerDevelopingSync()) {
    appendServerEventLog(
      "virtual-user",
      "implement scan skip — server developing",
    );
    return { ok: false, reason: "developing" };
  }
  const cfg = getVirtualUserContinuousSync();
  // 마스터 스위치 off: 새 전송만 중단 — 이미 queued/running 잡은 폴러·에이전트가 끝냄
  if (cfg.enabled === false) {
    return { ok: false, reason: "disabled" };
  }
  if (cfg.pausedByApiExhaustion) {
    return { ok: false, reason: "api-exhausted" };
  }
  if (cfg.autoImplement === false) {
    return { ok: false, reason: "auto-off" };
  }
  return dispatchNextVirtualUserImplement();
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

  // 상시가동: 부팅 시 enabled·autoImplement 강제 on (env=0만 예외)
  patchVirtualUserContinuousSync({
    intervalMs: IMPLEMENT_SCAN_MS,
  });
  ensureVirtualUserAutoImproveOnBoot();
  const after = getVirtualUserContinuousSync();
  appendServerEventLog(
    "virtual-user",
    `explore=always-on(novelty) gap=${EXPLORE_GAP_MS}ms · implementScan=${after.intervalMs}ms enabled=${after.enabled} autoImplement=${after.autoImplement} boot=${boot.reason || "ok"}`,
  );
  markPollerBootStarted(POLLER_ID);

  // 탐색: 거의 연속 루프
  scheduleExploreSoon(45_000);

  // 매니저 검토: 45초마다 (프롬프트 게이트)
  if (managerTimer) clearInterval(managerTimer);
  managerTimer = setInterval(() => {
    tickManagerReviewOnce();
  }, MANAGER_SCAN_MS);
  setTimeout(() => tickManagerReviewOnce(), 12_000);

  // 에이전트 전송: 3분마다, 개발 중 아닐 때만
  if (implementTimer) clearInterval(implementTimer);
  implementTimer = setInterval(() => {
    void tickImplementScanOnce().catch(() => {});
  }, IMPLEMENT_SCAN_MS);
  setTimeout(() => {
    void tickImplementScanOnce().catch(() => {});
  }, 60_000);
}

/** 관리 UI에서 enabled 바뀐 뒤 탐색 루프 유지 */
export function rescheduleVirtualUserContinuousPoller() {
  if (!started) return;
  const cfg = getVirtualUserContinuousSync();
  if (cfg.enabled && !exploreTimer && !running) {
    scheduleExploreSoon(EXPLORE_GAP_MS);
  }
}
