import { randomUUID } from "node:crypto";
import { normalizeAccessIp } from "./access-control.js";
import { clientIp } from "./access-log.js";

const MAX_ENTRIES = 100;

/**
 * @typedef {{
 *   id: string;
 *   requestedAt: string;
 *   clientIp: string;
 *   instruction: string;
 *   context: string;
 *   outcome: "pending" | "ok" | "error";
 *   finishedAt?: string;
 *   durationMs?: number;
 *   status?: string;
 *   runtime?: string;
 *   result?: string;
 *   error?: string;
 * }} OpsAgentHistoryEntry
 */

/** @type {OpsAgentHistoryEntry[]} */
const entries = [];

function trimResult(s, max = 96_000) {
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated)`;
}

/**
 * @param {import("express").Request} req
 * @param {{ instruction: string; context: string }} body
 * @returns {{ id: string; requestedAt: string; clientIp: string }}
 */
export function startOpsAgentHistoryRecord(req, body) {
  const id = randomUUID();
  const requestedAt = new Date().toISOString();
  const ip = normalizeAccessIp(clientIp(req)) || "-";
  entries.push({
    id,
    requestedAt,
    clientIp: ip,
    instruction: body.instruction,
    context: body.context,
    outcome: "pending",
  });
  while (entries.length > MAX_ENTRIES) entries.shift();
  return { id, requestedAt, clientIp: ip };
}

/**
 * @param {string} id
 * @param {{
 *   outcome: "ok" | "error";
 *   error?: string;
 *   result?: string;
 *   durationMs?: number;
 *   status?: string;
 *   runtime?: string;
 * }} patch
 */
export function finishOpsAgentHistoryRecord(id, patch) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  e.outcome = patch.outcome;
  e.finishedAt = new Date().toISOString();
  if (patch.error !== undefined) e.error = patch.error;
  if (patch.result !== undefined) e.result = trimResult(patch.result);
  if (patch.durationMs !== undefined) e.durationMs = patch.durationMs;
  if (patch.status !== undefined) e.status = patch.status;
  if (patch.runtime !== undefined) e.runtime = patch.runtime;
}

/** 최신 요청이 앞에 오도록 */
export function getOpsAgentHistorySnapshot() {
  return [...entries].reverse();
}
