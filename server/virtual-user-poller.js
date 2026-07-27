/**
 * 가상 사용자 연속 탐색 폴러
 * - 서버 기동 중 주기적으로 Playwright+시드 피드백
 * - 포화 시 러너가 만족도를 올려 새 이슈를 찾음
 */
import { appendServerEventLog } from "./access-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import {
  getVirtualUserContinuousSync,
  patchVirtualUserContinuousSync,
} from "./virtual-user-store.js";
import { runVirtualUserSession } from "./virtual-user-runner.js";

const POLLER_ID = "virtual-user-continuous";

let started = false;
let running = false;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

function intervalMsFromStore() {
  const cfg = getVirtualUserContinuousSync();
  const n = Number(cfg.intervalMs);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 60 * 60_000) : 8 * 60_000;
}

export function getVirtualUserContinuousPollIntervalMs() {
  return intervalMsFromStore();
}

export function isVirtualUserContinuousBusy() {
  return running;
}

export async function tickVirtualUserContinuousOnce() {
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync(POLLER_ID, async () => {
    const cfg = getVirtualUserContinuousSync();
    if (!cfg.enabled) return { ok: false, reason: "disabled" };

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
          `continuous tick ok created=${result.createdCount ?? 0} escalations=${result.escalations?.length ?? 0}`,
        );
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchVirtualUserContinuousSync({
        lastTickAtMs: Date.now(),
        lastError: msg,
      });
      appendServerEventLog("virtual-user", `continuous tick fail ${msg}`);
      return { ok: false, error: msg };
    } finally {
      running = false;
    }
  });
}

function scheduleNext() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const ms = intervalMsFromStore();
  timer = setInterval(() => {
    void tickVirtualUserContinuousOnce().catch(() => {});
  }, ms);
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

  const cfg = getVirtualUserContinuousSync();
  appendServerEventLog(
    "virtual-user",
    `continuous poller on intervalMs=${cfg.intervalMs} enabled=${cfg.enabled}`,
  );
  markPollerBootStarted(POLLER_ID);

  // 부팅 직후는 Vite/프론트 준비 여유
  setTimeout(() => {
    void tickVirtualUserContinuousOnce().catch(() => {});
  }, 45_000);

  scheduleNext();
}

/** 관리 UI에서 interval·enabled 바뀐 뒤 재스케줄 */
export function rescheduleVirtualUserContinuousPoller() {
  if (!started) return;
  scheduleNext();
}
