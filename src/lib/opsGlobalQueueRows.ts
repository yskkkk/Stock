import type {
  OpsAgentQueueEntry,
  OpsAgentQueueSource,
  OpsRecordModeItem,
} from "../api";
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

function recordStatusLabel(s: OpsRecordModeItem["status"]): string {
  if (s === "running") return ko.app.opsRecordModeStatusRunning;
  if (s === "done") return ko.app.opsRecordModeStatusDone;
  if (s === "error") return ko.app.opsRecordModeStatusError;
  return ko.app.opsRecordModeStatusPending;
}

function recordToCardClass(s: OpsRecordModeItem["status"]): OpsGlobalQueueCardClass {
  if (s === "running") return "running";
  if (s === "pending") return "waiting";
  if (s === "done") return "done";
  return "error";
}

function parseAgentEntry(raw: unknown): OpsAgentQueueEntry | null {
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

function parseRecordItem(raw: unknown): OpsRecordModeItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = normalizeOpQueueId(o.id);
  if (!id) return null;
  const st = o.status;
  const status: OpsRecordModeItem["status"] =
    st === "pending" || st === "running" || st === "done" || st === "error"
      ? st
      : "pending";
  return {
    id,
    instruction: String(o.instruction ?? ""),
    status,
    createdAtMs:
      typeof o.createdAtMs === "number" && Number.isFinite(o.createdAtMs)
        ? o.createdAtMs
        : 0,
    unifiedQueueSeq: seqNum(o.unifiedQueueSeq),
  };
}

export function buildOpsGlobalQueueRows(
  agentRaw: unknown[],
  recordRaw: unknown[],
): OpsGlobalQueueRow[] {
  const agent = agentRaw.map(parseAgentEntry).filter((x): x is OpsAgentQueueEntry => x != null);
  const recItems = recordRaw.map(parseRecordItem).filter((x): x is OpsRecordModeItem => x != null);

  const out: Omit<OpsGlobalQueueRow, "processRankDisplay">[] = [];
  for (const e of agent) {
    const sid = normalizeOpQueueId(e.id);
    const sn = seqNum(e.unifiedQueueSeq);
    const titleFull = queueInstructionFull(e);
    const titleSource = String(e.instructionPreview ?? "").trim() || titleFull;
    const ip = e.requestIp?.trim() ?? "";
    const agentSource: OpsAgentQueueSource | undefined =
      e.source === "ide" || e.source === "web"
        ? e.source
        : e.requestIp?.trim() === "cursor-ide"
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
      hideIp: ip === "cursor-ide",
      requestTitle: summarizeQueueTitle(titleSource),
      requestTitleFull: titleFull || titleSource,
      timeMs: e.enqueuedAtMs ?? 0,
    });
  }
  for (const it of recItems) {
    if (it.status === "error") continue;
    const sid = normalizeOpQueueId(it.id);
    const sn = seqNum(it.unifiedQueueSeq);
    const titleFull = String(it.instruction ?? "").trim();
    out.push({
      key: `r:${sid}`,
      kind: "record",
      sortKey: sortKeyFrom(sn, it.createdAtMs ?? 0),
      cardClass: recordToCardClass(it.status),
      unifiedSeq: sn,
      statusLabel: recordStatusLabel(it.status),
      ipDisplay: "—",
      hideIp: true,
      requestTitle: summarizeQueueTitle(titleFull),
      requestTitleFull: titleFull,
      timeMs: it.createdAtMs ?? 0,
    });
  }
  out.sort((a, b) => a.sortKey - b.sortKey || a.key.localeCompare(b.key));
  return out.map((r, i) => ({
    ...r,
    processRankDisplay: r.unifiedSeq != null ? `#${r.unifiedSeq}` : `${i + 1}`,
  }));
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
  return buildOpsGlobalQueueRows(payload.agentEntries, payload.recordItems);
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

export function writeOpsDevQueueDisplayCache(payload: OpsDevQueueDisplayPayload): void {
  if (typeof sessionStorage === "undefined") return;
  try {
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
