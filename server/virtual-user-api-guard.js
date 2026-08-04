/**
 * Cursor API 토큰/쿼터 소진 감지 → 가상 사용자 전체 정지(탐색·자동 구현)
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
    /token[\s_-]?(limit|budget|quota|exhausted)/.test(s) ||
    /monthly[\s_-]?(limit|budget|quota)/.test(s) ||
    /api[\s_-]?key.*(invalid|missing|expired|revoked)/.test(s) ||
    (/cursor_api_key/.test(s) &&
      /(invalid|missing|expired|revoked|not set|없|설정)/.test(s))
  );
}

export function hasCursorApiKey() {
  return Boolean(String(process.env.CURSOR_API_KEY ?? "").trim());
}

/**
 * API 소진 시 가상 사용자 전체 정지(탐색·자동 구현).
 * 관리자가 마스터를 다시 켜기 전까지 유지(서버 재기동으로 자동 해제하지 않음).
 * @param {string} reason
 */
export function pauseVirtualUserForApiExhaustion(reason) {
  const msg = String(reason ?? "Cursor API 토큰/쿼터 소진").slice(0, 500);
  const cur = getVirtualUserContinuousSync();
  if (
    cur.pausedByApiExhaustion &&
    cur.enabled === false &&
    cur.autoImplement === false
  ) {
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
    `stopped by API exhaustion (explore+implement off): ${msg}`,
  );
  return { ok: true, already: false };
}

/** 사용자가 다시 켤 때 해제 */
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
 * 서버 기동: 상시 가동 복구.
 * - STOCK_VIRTUAL_USER_CONTINUOUS=0 → off
 * - pausedByApiExhaustion → 그대로 정지 유지(토큰 소진 후 재기동해도 자동 재개 금지)
 * - 키 없음 → 전체 정지
 */
export function ensureVirtualUserAutoImproveOnBoot() {
  if (process.env.STOCK_VIRTUAL_USER_CONTINUOUS === "0") {
    return { ok: false, reason: "env-off" };
  }
  const cur = getVirtualUserContinuousSync();
  if (cur.pausedByApiExhaustion) {
    patchVirtualUserContinuousSync({
      enabled: false,
      autoImplement: false,
    });
    appendServerEventLog(
      "virtual-user",
      `boot: stay stopped (API exhaustion) reason=${String(cur.pausedReason || "").slice(0, 160)}`,
    );
    return {
      ok: true,
      reason: "api-exhausted-stay-off",
      enabled: false,
      autoImplement: false,
    };
  }
  if (!hasCursorApiKey()) {
    pauseVirtualUserForApiExhaustion(
      "CURSOR_API_KEY 없음 — 가상 사용자를 정지했습니다. .env에 키를 넣고 관리자에서 다시 켜 주세요.",
    );
    return {
      ok: true,
      reason: "stopped-no-api-key",
      enabled: false,
      autoImplement: false,
    };
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
 * 탐색 루프용: 꺼져 있으면 다시 켠다.
 * API 소진 정지·env=0 이면 재가동하지 않음.
 */
export function ensureVirtualUserContinuousAlwaysOn() {
  if (process.env.STOCK_VIRTUAL_USER_CONTINUOUS === "0") {
    return { ok: false, reason: "env-off" };
  }
  const cur = getVirtualUserContinuousSync();
  if (cur.pausedByApiExhaustion) {
    return { ok: false, reason: "api-exhausted" };
  }
  if (!hasCursorApiKey()) {
    return { ok: false, reason: "no-api-key" };
  }
  if (cur.enabled && cur.autoImplement === true) {
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
