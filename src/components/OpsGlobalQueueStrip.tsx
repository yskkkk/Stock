import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import {
  fetchOpsCursorAgentQueue,
  fetchOpsRecordMode,
  type OpsAgentQueueEntry,
  type OpsRecordModeItem,
} from "../api";
import { ko } from "../i18n/ko";

const POLL_MS = 5000;

type CardClass = "running" | "waiting" | "done" | "error";

type StripRow = {
  key: string;
  sortKey: number;
  cardClass: CardClass;
  kind: "agent" | "record";
  unifiedSeq: number | null;
  /** 표시용: 단일 큐 순번 `#n` 또는 목록 내 순서 */
  processRankDisplay: string;
  statusLabel: string;
  ipDisplay: string;
  requestTitle: string;
  timeMs: number;
};

function normalizeOpQueueId(id: unknown): string {
  return String(id ?? "").trim();
}

function previewOneLine(text: string, max = 72): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? text;
  const t = line.trim();
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function clampDisplay(text: string, max = 110): string {
  const t = text.trim();
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
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

function recordToCardClass(s: OpsRecordModeItem["status"]): CardClass {
  if (s === "running") return "running";
  if (s === "pending") return "waiting";
  if (s === "done") return "done";
  return "error";
}

function formatQueueTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function OpsQueueUnifiedSeqBadge({ seq }: { seq?: number | null }) {
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq < 1) return null;
  return (
    <span className="ops-agent-queue-card__seq" title={ko.app.opsUnifiedQueueSeqTitle}>
      #{seq}
    </span>
  );
}

function sourceLabelFor(kind: StripRow["kind"]): string {
  return kind === "agent" ? ko.app.opsGlobalQueueSourceAgent : ko.app.opsGlobalQueueSourceRecord;
}

export default function OpsGlobalQueueStrip({ onOpenOps }: { onOpenOps: () => void }) {
  const [rows, setRows] = useState<StripRow[]>([]);

  const pull = useCallback(() => {
    void Promise.all([fetchOpsCursorAgentQueue(), fetchOpsRecordMode()])
      .then(([q, rec]) => {
        const agent: OpsAgentQueueEntry[] = Array.isArray(q.entries) ? q.entries : [];
        const recItems: OpsRecordModeItem[] = Array.isArray(rec.items) ? rec.items : [];
        const out: StripRow[] = [];
        for (const e of agent) {
          const sid = normalizeOpQueueId(e.id);
          const sn = seqNum(e.unifiedQueueSeq);
          const pv = previewOneLine(
            e.instructionPreview || e.instructionBody || e.instructionTooltip || "",
          );
          const titleRaw = String(e.instructionTooltip ?? e.instructionBody ?? e.instructionPreview ?? pv);
          out.push({
            key: `a:${sid}`,
            kind: "agent",
            sortKey: sortKeyFrom(sn, e.enqueuedAtMs ?? 0),
            cardClass: e.status === "running" ? "running" : "waiting",
            unifiedSeq: sn,
            processRankDisplay: "",
            statusLabel:
              e.status === "running"
                ? ko.app.opsHistoryStatusRunning
                : ko.app.opsAgentQueueWaiting,
            ipDisplay: e.requestIp?.trim() ? e.requestIp.trim() : "—",
            requestTitle: clampDisplay(titleRaw),
            timeMs: e.enqueuedAtMs ?? 0,
          });
        }
        for (const it of recItems) {
          if (it.status === "error") continue;
          const sid = normalizeOpQueueId(it.id);
          const sn = seqNum(it.unifiedQueueSeq);
          const pv = previewOneLine(it.instruction);
          const titleRaw = it.instruction.trim() ? it.instruction : pv;
          out.push({
            key: `r:${sid}`,
            kind: "record",
            sortKey: sortKeyFrom(sn, it.createdAtMs ?? 0),
            cardClass: recordToCardClass(it.status),
            unifiedSeq: sn,
            processRankDisplay: "",
            statusLabel: recordStatusLabel(it.status),
            ipDisplay: "—",
            requestTitle: clampDisplay(titleRaw),
            timeMs: it.createdAtMs ?? 0,
          });
        }
        out.sort((a, b) => a.sortKey - b.sortKey || a.key.localeCompare(b.key));
        const ranked = out.map((r, i) => ({
          ...r,
          processRankDisplay:
            r.unifiedSeq != null ? `#${r.unifiedSeq}` : `${i + 1}`,
        }));
        setRows(ranked);
      })
      .catch(() => {
        setRows([]);
      });
  }, []);

  useEffect(() => {
    pull();
    const id = window.setInterval(pull, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pull]);

  const openCard = useCallback(() => {
    onOpenOps();
  }, [onOpenOps]);

  const onCardKeyDown = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onOpenOps();
      }
    },
    [onOpenOps],
  );

  return (
    <section
      className="ops-global-queue-stack card ops-management__server-queue"
      aria-label={ko.app.opsGlobalQueueTitle}
    >
      <h2 className="ops-global-queue-stack__heading">{ko.app.opsGlobalQueueTitle}</h2>
      <div
        className="ops-agent-queue-track ops-management__server-queue-track ops-global-queue-stack__track"
        role="list"
      >
        {rows.length === 0
          ? null
          : rows.map((r) => {
            const aria = `${sourceLabelFor(r.kind)}. ${ko.app.opsGlobalQueueFieldProcessRank}: ${r.processRankDisplay}. ${ko.app.opsGlobalQueueFieldStatus}: ${r.statusLabel}. ${ko.app.opsGlobalQueueFieldTitle}: ${r.requestTitle}`;
            return (
              <div
                key={r.key}
                className={`ops-agent-queue-card ops-agent-queue-card--${r.cardClass} ops-global-queue-card`}
                role="listitem"
                tabIndex={0}
                aria-label={aria}
                title={r.requestTitle.replace(/\s+/g, " ").trim()}
                onClick={openCard}
                onKeyDown={onCardKeyDown}
              >
                <div className="ops-global-queue-card__seq-row">
                  <OpsQueueUnifiedSeqBadge seq={r.unifiedSeq} />
                </div>
                <dl className="ops-global-queue-card__fields">
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldProcessRank}</dt>
                    <dd
                      className="ops-global-queue-card__process-rank"
                      title={ko.app.opsUnifiedQueueSeqTitle}
                    >
                      {r.processRankDisplay}
                    </dd>
                  </div>
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldSource}</dt>
                    <dd>{sourceLabelFor(r.kind)}</dd>
                  </div>
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldIp}</dt>
                    <dd className="ops-management__stream-v--mono">{r.ipDisplay}</dd>
                  </div>
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldStatus}</dt>
                    <dd
                      className={`ops-global-queue-card__value ops-global-queue-card__value--${r.cardClass}`}
                    >
                      {r.statusLabel}
                    </dd>
                  </div>
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldTitle}</dt>
                    <dd className="ops-global-queue-card__title-dd">{r.requestTitle}</dd>
                  </div>
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldRegistered}</dt>
                    <dd>{formatQueueTime(r.timeMs)}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
      </div>
    </section>
  );
}
