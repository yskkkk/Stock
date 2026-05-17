/**
 * 동일 IP에서 진행 중인 Cursor 에이전트(SSE) 요청 — 리다이렉션 후 요청 내용 복원용 (메모리)
 */
import { normalizeAccessIp } from "./access-control.js";

/** @typedef {{ instruction: string; context: string; startedAtMs: number }} OpsAgentPending */

/** @type {Map<string, OpsAgentPending>} */
const byIp = new Map();

/**
 * @param {string} ip
 * @param {string} instruction
 * @param {string} context
 */
export function setOpsAgentPending(ip, instruction, context) {
  const n = normalizeAccessIp(ip);
  if (!n) return;
  byIp.set(n, {
    instruction: String(instruction ?? ""),
    context: String(context ?? ""),
    startedAtMs: Date.now(),
  });
}

/** @param {string} ip */
export function clearOpsAgentPending(ip) {
  const n = normalizeAccessIp(ip);
  if (n) byIp.delete(n);
}

/**
 * @param {string} ip
 * @returns {OpsAgentPending | null}
 */
export function getOpsAgentPendingForIp(ip) {
  const n = normalizeAccessIp(ip);
  if (!n) return null;
  return byIp.get(n) ?? null;
}
