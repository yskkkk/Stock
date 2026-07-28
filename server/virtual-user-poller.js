/**
 * 가상 사용자 연속 탐색 폴러
 * - 서버 기동 시 기본 ON (부족점 탐색 → 자동 구현)
 * - Cursor API 토큰/쿼터 소진 시 자동 정지
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

const POLLER_ID = "virtual-user-continuous";
const IMPLEMENT_SCAN_MS = 3 * 60_000;

let started = false;
let running = false;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let implementTimer = null;

function intervalMsFromStore() {
  const cfg = getVirtualUserContinuousSync();
  const n = Number(cfg.intervalMs);
  // 최소 3분 · 기본 3분
  return Number.isFinite(n) && n >= 60_000
    ? Math.min(Math.max(n, 3 * 60_000), 60 * 60_000)
    : IMPLEMENT_SCAN_MS;
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
    if (cfg.pausedByApiExhaustion) {
      return { ok: false, reason: "api-exhausted", error: cfg.pausedReason };
    }
    if (!cfg.enabled) return { ok: false, reason: "disabled" };

    // 자동 구현이 켜져 있는데 키가 없으면 전체 루프 정지
    if (cfg.autoImplement !== false && !hasCursorApiKey()) {
      pauseVirtualUserForApiExhaustion(
        "CURSOR_API_KEY 없음 — 가상 사용자 자동 개선을 정지했습니다.",
      );
      return { ok: false, reason: "no-api-key" };
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
          `continuous tick ok created=${result.createdCount ?? 0} escalations=${result.escalations?.length ?? 0}`,
        );
      }
      // 세션 안에서도 dispatch 하지만, 안전망으로 한 번 더
      try {
        await dispatchNextVirtualUserImplement();
      } catch {
        /* optional */
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
  const cfg = getVirtualUserContinuousSync();
  // 탐색·구현 스캔 주기 3분으로 맞춤 (기존 8분 저장값 덮어씀)
  if (Number(cfg.intervalMs) !== IMPLEMENT_SCAN_MS) {
    patchVirtualUserContinuousSync({ intervalMs: IMPLEMENT_SCAN_MS });
  }
  const after = getVirtualUserContinuousSync();
  appendServerEventLog(
    "virtual-user",
    `continuous poller on intervalMs=${after.intervalMs} enabled=${after.enabled} autoImplement=${after.autoImplement} boot=${boot.reason || "ok"}`,
  );
  markPollerBootStarted(POLLER_ID);

  // 부팅 직후는 Vite/프론트 준비 여유 후 탐색 + 대기 피드백 1건 실행
  setTimeout(() => {
    void tickVirtualUserContinuousOnce().catch(() => {});
    void dispatchNextVirtualUserImplement().catch(() => {});
  }, 45_000);

  scheduleNext();

  if (implementTimer) clearInterval(implementTimer);
  implementTimer = setInterval(() => {
    void dispatchNextVirtualUserImplement().catch(() => {});
  }, IMPLEMENT_SCAN_MS);
}

/** 관리 UI에서 interval·enabled 바뀐 뒤 재스케줄 */
export function rescheduleVirtualUserContinuousPoller() {
  if (!started) return;
  scheduleNext();
}
