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
 * API 소진 시 연속 탐색·자동 구현 모두 정지
 * @param {string} reason
 */
export function pauseVirtualUserForApiExhaustion(reason) {
  const msg = String(reason ?? "Cursor API 토큰/쿼터 소진").slice(0, 500);
  const cur = getVirtualUserContinuousSync();
  if (cur.pausedByApiExhaustion && cur.enabled === false && cur.autoImplement === false) {
    patchVirtualUserContinuousSync({
      lastError: msg,
      pausedAtMs: cur.pausedAtMs ?? Date.now(),
      pausedReason: msg,
    });
    return { ok: true, already: true };
  }
  patchVirtualUserContinuousSync({
    enabled: false,
    autoImplement: false,
    pausedByApiExhaustion: true,
    pausedAtMs: Date.now(),
    pausedReason: msg,
    lastError: msg,
  });
  appendServerEventLog(
    "virtual-user",
    `paused by API exhaustion: ${msg}`,
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
 * 서버 기동 시: API 키 있으면 연속 탐색+자동 구현을 기본 ON
 * (소진 정지 상태였어도 키가 있으면 재개)
 */
export function ensureVirtualUserAutoImproveOnBoot() {
  if (process.env.STOCK_VIRTUAL_USER_CONTINUOUS === "0") {
    return { ok: false, reason: "env-off" };
  }
  if (!hasCursorApiKey()) {
    pauseVirtualUserForApiExhaustion(
      "CURSOR_API_KEY 없음 — 자동 개선을 정지합니다. .env에 키를 넣은 뒤 서버를 재시작하거나 관리자에서 연속 탐색을 켜 주세요.",
    );
    return { ok: false, reason: "no-api-key" };
  }
  clearVirtualUserApiExhaustionPause();
  patchVirtualUserContinuousSync({
    enabled: true,
    autoImplement: true,
    lastError: null,
  });
  appendServerEventLog(
    "virtual-user",
    "boot: continuous explore + auto-implement enabled",
  );
  return { ok: true };
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
