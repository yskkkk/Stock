/**
 * Cursor API 토큰/쿼터 소진 감지 → 가상 사용자 자동 개선 정지
 */
import { appendServerEventLog } from "./access-log.js";
import {
  getVirtualUserContinuousSync,
  patchVirtualUserContinuousSync,
} from "./virtual-user-store.js";

/**
 * @param {unknown} errOrMsg
 * @returns {boolean}
 */
export function isCursorApiExhaustedError(errOrMsg) {
  const raw =
    errOrMsg instanceof Error
      ? `${errOrMsg.message}\n${errOrMsg.name}\n${/** @type {{ code?: string }} */ (errOrMsg).code ?? ""}`
      : String(errOrMsg ?? "");
  const s = raw.toLowerCase();
  if (!s.trim()) return false;

  // 명시 코드
  if (/\b(no_api_key|resource_exhausted|insufficient_quota|billing_error)\b/i.test(raw)) {
    return true;
  }

  return (
    /\b429\b/.test(s) ||
    /\b402\b/.test(s) ||
    /rate[\s_-]?limit/.test(s) ||
    /too many requests/.test(s) ||
    /quota/.test(s) ||
    /usage[\s_-]?limit/.test(s) ||
    /spend[\s_-]?limit/.test(s) ||
    /exhausted/.test(s) ||
    /insufficient[\s_-]?(credit|funds|quota)/.test(s) ||
    /payment[\s_-]?required/.test(s) ||
    /billing/.test(s) ||
    /out of credits/.test(s) ||
    /credit[\s_-]?limit/.test(s) ||
    /api[\s_-]?key.*(invalid|missing|expired|revoked)/.test(s) ||
    (/cursor_api_key/.test(s) &&
      /(invalid|missing|expired|revoked|not set|없|설정)/.test(s))
  );
}

export function hasCursorApiKey() {
  return Boolean(String(process.env.CURSOR_API_KEY ?? "").trim());
}

/**
 * API 소진 시 자동 구현만 정지 — 탐색(상시가동)은 유지
 * @param {string} reason
 */
export function pauseVirtualUserForApiExhaustion(reason) {
  const msg = String(reason ?? "Cursor API 토큰/쿼터 소진").slice(0, 500);
  const cur = getVirtualUserContinuousSync();
  if (cur.pausedByApiExhaustion && cur.autoImplement === false) {
    patchVirtualUserContinuousSync({
      lastError: msg,
      pausedAtMs: cur.pausedAtMs ?? Date.now(),
      pausedReason: msg,
      // 탐색은 계속
      enabled: true,
    });
    return { ok: true, already: true };
  }
  patchVirtualUserContinuousSync({
    enabled: true,
    autoImplement: false,
    pausedByApiExhaustion: true,
    pausedAtMs: Date.now(),
    pausedReason: msg,
    lastError: msg,
  });
  appendServerEventLog(
    "virtual-user",
    `autoImplement paused by API exhaustion (explore stays on): ${msg}`,
  );
  return { ok: true, already: false };
}

/** 사용자가 다시 켤 때 / 부팅 시 키 있으면 해제 */
export function clearVirtualUserApiExhaustionPause() {
  const cur = getVirtualUserContinuousSync();
  if (!cur.pausedByApiExhaustion) return { ok: true, cleared: false };
  patchVirtualUserContinuousSync({
    pausedByApiExhaustion: false,
    pausedAtMs: null,
    pausedReason: null,
    lastError: null,
  });
  appendServerEventLog("virtual-user", "API exhaustion pause cleared");
  return { ok: true, cleared: true };
}

/**
 * 서버 기동·감시: 가상 사용자 연속 탐색을 상시 가동.
 * STOCK_VIRTUAL_USER_CONTINUOUS=0 일 때만 완전 off.
 * API 키 없으면 탐색은 on, 자동 구현만 정지.
 */
export function ensureVirtualUserAutoImproveOnBoot() {
  if (process.env.STOCK_VIRTUAL_USER_CONTINUOUS === "0") {
    return { ok: false, reason: "env-off" };
  }
  if (!hasCursorApiKey()) {
    pauseVirtualUserForApiExhaustion(
      "CURSOR_API_KEY 없음 — 자동 구현만 정지. 탐색은 상시 가동. .env에 키를 넣으면 자동 구현도 재개.",
    );
    patchVirtualUserContinuousSync({ enabled: true });
    return { ok: true, reason: "explore-only-no-api-key", enabled: true, autoImplement: false };
  }
  const cur = getVirtualUserContinuousSync();
  if (cur.pausedByApiExhaustion) {
    clearVirtualUserApiExhaustionPause();
  }
  patchVirtualUserContinuousSync({
    enabled: true,
    autoImplement: true,
    pausedByApiExhaustion: false,
    pausedAtMs: null,
    pausedReason: null,
    lastError: null,
  });
  const after = getVirtualUserContinuousSync();
  appendServerEventLog(
    "virtual-user",
    `boot: always-on enabled=${after.enabled} autoImplement=${after.autoImplement}`,
  );
  return { ok: true, enabled: after.enabled, autoImplement: after.autoImplement };
}

/**
 * 탐색 루프용: 꺼져 있으면 다시 켠다 (STOCK_VIRTUAL_USER_CONTINUOUS=0 제외)
 */
export function ensureVirtualUserContinuousAlwaysOn() {
  if (process.env.STOCK_VIRTUAL_USER_CONTINUOUS === "0") {
    return { ok: false, reason: "env-off" };
  }
  const cur = getVirtualUserContinuousSync();
  const keyOk = hasCursorApiKey();
  if (
    cur.enabled &&
    (!keyOk ? cur.autoImplement === false : cur.autoImplement === true) &&
    (!keyOk || !cur.pausedByApiExhaustion)
  ) {
    return { ok: true, reenabled: false };
  }
  if (!cur.enabled) {
    appendServerEventLog("virtual-user", "continuous was off — re-enabling always-on");
  }
  return ensureVirtualUserAutoImproveOnBoot();
}

/**
 * @param {unknown} err
 */
export function maybePauseVirtualUserFromAgentError(err) {
  if (!isCursorApiExhaustedError(err)) return { paused: false };
  const msg = err instanceof Error ? err.message : String(err ?? "");
  pauseVirtualUserForApiExhaustion(msg);
  return { paused: true };
}
