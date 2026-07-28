/**
 * 가상 사용자 연속 탐색 폴러
 * - 탐색: 세션 끝나자마자 바로 다음(3분 텀 없음) — 피드백은 대기 없이 계속 쌓임
 * - 에이전트 전송: 3분마다 스캔, 서버가 개발 중(에이전트 실행 중)이 아닐 때만 1건 FIFO
 * - 에이전트 1건 제한 이유: ops 큐·워킹트리 동시 수정 충돌 방지
 */
import { appendServerEventLog } from "./access-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import {
  getVirtualUserContinuousSync,
  patchVirtualUserContinuousSync,
  ensureDefaultPersonasPresentSync,
} from "./virtual-user-store.js";
import { runVirtualUserSession } from "./virtual-user-runner.js";
import {
  ensureVirtualUserAutoImproveOnBoot,
  hasCursorApiKey,
  pauseVirtualUserForApiExhaustion,
} from "./virtual-user-api-guard.js";
import { enrichVirtualFeedbackNarrativesSync } from "./virtual-user-feedback-enrich.js";
import { dispatchNextVirtualUserImplement } from "./virtual-user-auto-implement.js";
import { isOpsAgentJobRunning } from "./ops-agent-job-queue.js";

const POLLER_ID = "virtual-user-continuous";
/** 에이전트 전송 스캔 주기 */
const IMPLEMENT_SCAN_MS = 3 * 60_000;
/** 탐색 세션 사이 최소 간격(거의 연속, 숨 돌릴 틈만) */
const EXPLORE_GAP_MS = 2_000;

let started = false;
let running = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let exploreTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let implementTimer = null;

export function getVirtualUserContinuousPollIntervalMs() {
  return IMPLEMENT_SCAN_MS;
}

export function isVirtualUserContinuousBusy() {
  return running;
}

/** 서버에서 코딩 에이전트가 돌고 있으면 true (VU·IDE·기록모드 공통 ops 큐) */
export function isServerDevelopingSync() {
  try {
    if (isOpsAgentJobRunning()) return true;
  } catch {
    /* optional */
  }
  return false;
}

export async function tickVirtualUserContinuousOnce() {
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync(POLLER_ID, async () => {
    const cfg = getVirtualUserContinuousSync();
    if (!cfg.enabled) return { ok: false, reason: "disabled" };

    if (cfg.autoImplement !== false && !hasCursorApiKey()) {
      pauseVirtualUserForApiExhaustion(
        "CURSOR_API_KEY 없음 — 에이전트 구현만 정지(피드백 탐색은 계속).",
      );
    }

    running = true;
    try {
      const result = await runVirtualUserSession({
        notifyTelegram: cfg.notifyTelegram === true,
        useBrowser: cfg.useBrowser !== false,
        continuous: true,
        maxPerPersona: 4,
      });
      patchVirtualUserContinuousSync({
        lastTickAtMs: Date.now(),
        lastSessionId: result.sessionId || null,
        lastError: result.ok ? null : String(result.error || "실패"),
        lastCreatedCount: Number(result.createdCount) || 0,
      });
      if (result.ok) {
        appendServerEventLog(
          "virtual-user",
          `explore tick ok created=${result.createdCount ?? 0} (stack only; agent via 3min idle scan)`,
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
      scheduleExploreSoon(EXPLORE_GAP_MS);
    })();
  }, delayMs);
}

/**
 * 3분마다: 개발 중이 아니면 대기 피드백 1건만 에이전트로
 */
async function tickImplementScanOnce() {
  if (isServerDevelopingSync()) {
    appendServerEventLog(
      "virtual-user",
      "implement scan skip — server developing",
    );
    return { ok: false, reason: "developing" };
  }
  const cfg = getVirtualUserContinuousSync();
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

  // intervalMs는 에이전트 스캔 주기 표시용으로 3분 고정
  patchVirtualUserContinuousSync({
    enabled: true,
    intervalMs: IMPLEMENT_SCAN_MS,
    autoImplement: true,
  });
  const after = getVirtualUserContinuousSync();
  appendServerEventLog(
    "virtual-user",
    `explore=continuous gap=${EXPLORE_GAP_MS}ms · implementScan=${after.intervalMs}ms enabled=${after.enabled} autoImplement=${after.autoImplement} boot=${boot.reason || "ok"}`,
  );
  markPollerBootStarted(POLLER_ID);

  // 탐색: 거의 연속 루프
  scheduleExploreSoon(45_000);

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
