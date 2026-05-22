import type { OpsAgentQueueEntry, OpsAgentQueueSource } from "../api";
import { ko } from "../i18n/ko";

const QUEUE_TITLE_DISPLAY_MAX = 52;

export type OpsGlobalQueueCardClass = "running" | "waiting" | "done" | "error";

export type OpsGlobalQueueRow = {
  key: string;
  sortKey: number;
  cardClass: OpsGlobalQueueCardClass;
  kind: "agent" | "record";
  agentSource?: OpsAgentQueueSource;
  unifiedSeq: number | null;
  processRankDisplay: string;
  statusLabel: string;
  ipDisplay: string;
  requestTitle: string;
  requestTitleFull: string;
  timeMs: number;
  hideIp: boolean;
};

function normalizeOpQueueId(id: unknown): string {
  return String(id ?? "").trim();
}

/** 개발 대기열 카드용 — 첫 문장만, 로그·access 꼬리 제거 */
export function summarizeQueueTitle(text: string, max = QUEUE_TITLE_DISPLAY_MAX): string {
  let t = String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const re of [/\[access\]/i, /\bGET\s+\/api\//i, /\bip=\d{1,3}\./]) {
    const m = t.search(re);
    if (m > 16) {
      t = t.slice(0, m).trim();
      break;
    }
  }
  const line = t.split(/\r?\n/).find((l) => l.trim().length > 0) ?? t;
  const one = line.trim();
  if (!one) return "—";
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function queueInstructionFull(e: OpsAgentQueueEntry): string {
  return [e.instructionPreview, e.instructionTooltip, e.instructionBody]
    .map((s) => String(s ?? "").trim())
    .find((s) => s.length > 0) ?? "";
}

function seqNum(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x) && x >= 1) return x;
  return null;
}

function sortKeyFrom(seq: number | null, tieMs: number): number {
  const s = seq != null ? seq : 1_000_000;
  return s * 1e15 + tieMs;
}

export function parseOpsDevQueueAgentEntry(raw: unknown): OpsAgentQueueEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = normalizeOpQueueId(o.id);
  if (!id) return null;
  const status = o.status === "running" ? "running" : "waiting";
  const source =
    o.source === "ide" || o.source === "web" ? o.source : undefined;
  return {
    id,
    requestIp: String(o.requestIp ?? ""),
    source,
    instructionPreview: String(o.instructionPreview ?? ""),
    instructionTooltip:
      typeof o.instructionTooltip === "string" ? o.instructionTooltip : undefined,
    instructionBody:
      typeof o.instructionBody === "string" ? o.instructionBody : undefined,
    enqueuedAtMs:
      typeof o.enqueuedAtMs === "number" && Number.isFinite(o.enqueuedAtMs)
        ? o.enqueuedAtMs
        : 0,
    status,
    unifiedQueueSeq: seqNum(o.unifiedQueueSeq) ?? undefined,
  };
}

export function parseOpsDevQueueAgentEntries(agentRaw: unknown[]): OpsAgentQueueEntry[] {
  return agentRaw
    .map(parseOpsDevQueueAgentEntry)
    .filter((x): x is OpsAgentQueueEntry => x != null);
}

export function buildOpsGlobalQueueRows(agentRaw: unknown[]): OpsGlobalQueueRow[] {
  const agent = parseOpsDevQueueAgentEntries(agentRaw);

  const out: Omit<OpsGlobalQueueRow, "processRankDisplay">[] = [];
  for (const e of agent) {
    const sid = normalizeOpQueueId(e.id);
    const sn = seqNum(e.unifiedQueueSeq);
    const titleFull = queueInstructionFull(e);
    const titleSource = String(e.instructionPreview ?? "").trim() || titleFull;
    const ip = e.requestIp?.trim() ?? "";
    const agentSource: OpsAgentQueueSource | undefined =
      ip === "claude-code"
        ? "ide"
        : e.source === "ide" || e.source === "web"
          ? e.source
          : ip === "cursor-ide"
            ? "ide"
            : "web";
    out.push({
      key: `a:${sid}`,
      kind: "agent",
      agentSource,
      sortKey: sortKeyFrom(sn, e.enqueuedAtMs ?? 0),
      cardClass: e.status === "running" ? "running" : "waiting",
      unifiedSeq: sn,
      statusLabel:
        e.status === "running"
          ? ko.app.opsHistoryStatusRunning
          : ko.app.opsAgentQueueWaiting,
      ipDisplay: ip || "—",
      hideIp: ip === "cursor-ide" || ip === "claude-code",
      requestTitle: summarizeQueueTitle(titleSource),
      requestTitleFull: titleFull || titleSource,
      timeMs: e.enqueuedAtMs ?? 0,
    });
  }
  out.sort((a, b) => a.sortKey - b.sortKey || a.key.localeCompare(b.key));
  return out.map((r, i) => ({
    ...r,
    processRankDisplay: r.unifiedSeq != null ? `#${r.unifiedSeq}` : `${i + 1}`,
  }));
}

/** 폴링·캐시 비교용 — agentEntries 내용이 같으면 동일 키 */
export function agentEntriesSnapshotKey(agentEntries: unknown[]): string {
  return JSON.stringify(agentEntries);
}

export const OPS_DEV_QUEUE_DISPLAY_CACHE_KEY = "stock-ops-dev-queue-display-v1";

export type OpsDevQueueDisplayPayload = {
  updatedAtMs?: number;
  agentEntries: unknown[];
  recordItems: unknown[];
};

export function rowsFromDevQueueDisplayPayload(
  payload: OpsDevQueueDisplayPayload,
): OpsGlobalQueueRow[] {
  return buildOpsGlobalQueueRows(payload.agentEntries);
}

export function readOpsDevQueueDisplayCache(): OpsGlobalQueueRow[] | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(OPS_DEV_QUEUE_DISPLAY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OpsDevQueueDisplayPayload;
    if (!Array.isArray(parsed.agentEntries) || !Array.isArray(parsed.recordItems)) {
      return null;
    }
    return rowsFromDevQueueDisplayPayload(parsed);
  } catch {
    return null;
  }
}

export function sourceLabelForRow(row: OpsGlobalQueueRow): string {
  if (row.kind === "record") return ko.app.opsGlobalQueueSourceRecord;
  if (row.agentSource === "ide") return ko.app.opsGlobalQueueSourceIde;
  if (row.agentSource === "web") return ko.app.opsGlobalQueueSourceWeb;
  return ko.app.opsGlobalQueueSourceWeb;
}

let lastSessionCacheAgentKey = "";

export function writeOpsDevQueueDisplayCache(payload: OpsDevQueueDisplayPayload): void {
  if (typeof sessionStorage === "undefined") return;
  const agentKey = agentEntriesSnapshotKey(payload.agentEntries);
  if (agentKey === lastSessionCacheAgentKey) return;
  lastSessionCacheAgentKey = agentKey;
  try {
    if (!payload.agentEntries.length && !payload.recordItems.length) {
      sessionStorage.removeItem(OPS_DEV_QUEUE_DISPLAY_CACHE_KEY);
      return;
    }
    sessionStorage.setItem(
      OPS_DEV_QUEUE_DISPLAY_CACHE_KEY,
      JSON.stringify({
        updatedAtMs: payload.updatedAtMs ?? Date.now(),
        agentEntries: payload.agentEntries,
        recordItems: payload.recordItems,
      }),
    );
  } catch {
    /* ignore quota */
  }
}
