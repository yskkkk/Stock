import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clearStockOpsInstructionDraft,
  deleteOpsAgentHistory,
  deleteOpsAgentHistoryEntry,
  fetchOpsAgentHistory,
  fetchOpsCursorAgentPending,
  fetchOpsCursorAgentQueue,
  fetchOpsCursorAgentStream,
  fetchOpsRecordMode,
  fetchOpsRecordModeActivity,
  postOpsAgentHistoryWorkspaceApplied,
  postOpsRecordModeJob,
  putOpsRecordMode,
  type OpsAgentHistoryEntry,
  type OpsAgentQueueEntry,
  type OpsCursorAgentPendingResponse,
  type OpsRecordModeActivityEntry,
  type OpsRecordModeItem,
} from "../api";
import { ko } from "../i18n/ko";

const HISTORY_POLL_MS = 2000;
const AGENT_QUEUE_POLL_MS = 5000;
/** 기록 모드(파일 요청) 대기 목록 — 에이전트 실행 큐와 동일 주기로 스냅샷 갱신 */
const RECORD_MODE_QUEUE_POLL_MS = AGENT_QUEUE_POLL_MS;
const FILE_ACTIVITY_POLL_MS = 5000;

function formatHistoryTs(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return String(ms);
  }
}

function historyStateLabel(s: OpsAgentHistoryEntry["state"]): string {
  if (s === "waiting") return ko.app.opsHistoryStatusWaiting;
  if (s === "running") return ko.app.opsHistoryStatusRunning;
  if (s === "error") return ko.app.opsHistoryStatusError;
  if (s === "cancelled") return ko.app.opsHistoryStatusCancelled;
  if (s === "rejected") return ko.app.opsHistoryStatusRejected;
  return ko.app.opsHistoryStatusOk;
}

/** 큐·기록 행 id 비교용(공백·타입 불일치로 서버 행이 중복 삽입되는 것 방지) */
function normalizeOpQueueId(id: unknown): string {
  return String(id ?? "").trim();
}

function newLocalQueueItemId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/** 동일 id가 next에 두 번 나오면(병합 버그·JSON 중복) 첫 등장 순서를 유지하고 마지막 병합본을 사용 */
function dedupeQueueRowsById<T extends { id: string }>(rows: T[]): T[] {
  const lastById = new Map<string, T>();
  for (const row of rows) {
    const id = normalizeOpQueueId(row.id);
    if (!id) continue;
    lastById.set(id, { ...row, id });
  }
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = normalizeOpQueueId(row.id);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const merged = lastById.get(id);
    if (merged) out.push(merged);
  }
  return out;
}

function mergeRecordModePoll(
  prev: OpsRecordModeItem[],
  server: OpsRecordModeItem[],
): OpsRecordModeItem[] {
  const srvById = new Map(
    server.map((x) => {
      const id = normalizeOpQueueId(x.id);
      return id ? ([id, { ...x, id }] as const) : null;
    }).filter((e): e is readonly [string, OpsRecordModeItem] => e != null),
  );
  const next = prev.map((row) => {
    const id = normalizeOpQueueId(row.id);
    const rowNorm = id ? { ...row, id } : row;
    const s = id ? srvById.get(id) : undefined;
    if (!s) return rowNorm;
    if (rowNorm.status === "pending" && s.status === "pending") {
      return {
        ...rowNorm,
        unifiedQueueSeq:
          typeof s.unifiedQueueSeq === "number" && Number.isFinite(s.unifiedQueueSeq)
            ? s.unifiedQueueSeq
            : (rowNorm.unifiedQueueSeq ?? null),
        createdAtMs: s.createdAtMs,
      };
    }
    return {
      ...rowNorm,
      unifiedQueueSeq:
        typeof s.unifiedQueueSeq === "number" && Number.isFinite(s.unifiedQueueSeq)
          ? s.unifiedQueueSeq
          : (rowNorm.unifiedQueueSeq ?? null),
      status: s.status,
      error: s.error ?? null,
      lockedAtMs: s.lockedAtMs ?? null,
      updatedAtMs: s.updatedAtMs ?? null,
      createdAtMs: s.createdAtMs,
      instruction:
        rowNorm.status === "pending" && s.status === "pending"
          ? rowNorm.instruction
          : s.instruction,
    };
  });
  for (const s of server) {
    const sid = normalizeOpQueueId(s.id);
    if (!sid) continue;
    const sNorm = { ...s, id: sid };
    if (!next.some((x) => normalizeOpQueueId(x.id) === sid)) next.push(sNorm);
  }
  return dedupeQueueRowsById(next);
}

function streamHeadlineFromInstruction(text: string, maxChars: number): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const t = line.trim();
  if (!t) return "";
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

/** 기록 모드 행을 에이전트 큐 카드 변형(`ops-agent-queue-card--*`)에 맞춤 */
function recordModeItemQueueCardClass(
  status: OpsRecordModeItem["status"],
): "running" | "waiting" | "done" | "error" {
  if (status === "running") return "running";
  if (status === "pending") return "waiting";
  if (status === "done") return "done";
  return "error";
}

function OpsQueueUnifiedSeqBadge({ seq }: { seq?: number | null }) {
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq < 1) return null;
  return (
    <span className="ops-agent-queue-card__seq" title={ko.app.opsUnifiedQueueSeqTitle}>
      #{seq}
    </span>
  );
}

function OpsManagementLiveStreamContent({
  streamHeadlineInstruction,
  phaseLine,
  cursorLine,
  toolLine,
  toolLog,
  thinkingLine,
  streamText,
  suppressHeadline = false,
}: {
  streamHeadlineInstruction: string;
  phaseLine: string;
  cursorLine: string;
  toolLine: string;
  /** 누적 도구·파일 요청 로그(이력용) */
  toolLog?: string;
  thinkingLine: string;
  streamText: string;
  /** 카드 바깥에 제목을 이미 렌더한 경우(저장 진행 로그 등) */
  suppressHeadline?: boolean;
}) {
  const head = streamHeadlineFromInstruction(streamHeadlineInstruction, 72);
  const titleText = head ? `${head} · ${ko.app.opsStreamTitle}` : ko.app.opsStreamTitle;

  return (
    <>
      {!suppressHeadline ? <p className="ops-management__stream-title">{titleText}</p> : null}
      {phaseLine ? (
        <p className="ops-management__stream-row">
          <span className="ops-management__stream-k">{ko.app.opsStreamPhase}</span>
          <span className="ops-management__stream-v">{phaseLine}</span>
        </p>
      ) : null}
      {cursorLine ? (
        <p className="ops-management__stream-row">
          <span className="ops-management__stream-k">{ko.app.opsStreamCursorStatus}</span>
          <span className="ops-management__stream-v ops-management__stream-v--mono">
            {cursorLine}
          </span>
        </p>
      ) : null}
      {toolLine ? (
        <p className="ops-management__stream-row">
          <span className="ops-management__stream-k">{ko.app.opsStreamTool}</span>
          <span className="ops-management__stream-v ops-management__stream-v--mono">
            {toolLine}
          </span>
        </p>
      ) : null}
      {toolLog?.trim() ? (
        <>
          <p className="ops-management__stream-title ops-management__stream-title--sub">
            {ko.app.opsHistoryToolLogTitle}
          </p>
          <pre className="ops-management__stream-pre ops-management__stream-pre--toollog">
            {toolLog.trim()}
          </pre>
        </>
      ) : null}
      {thinkingLine ? (
        <p className="ops-management__stream-row ops-management__stream-row--thinking">
          <span className="ops-management__stream-k">{ko.app.opsStreamThinking}</span>
          <span className="ops-management__stream-v">{thinkingLine}</span>
        </p>
      ) : null}
      {streamText ? (
        <pre className="ops-management__stream-pre">{streamText}</pre>
      ) : null}
    </>
  );
}

function OpsAgentQueueProgressModal({
  runId,
  queueEntries,
  historyRuns,
  available,
  onClose,
  onRetryInstruction,
}: {
  runId: string;
  queueEntries: OpsAgentQueueEntry[];
  historyRuns: OpsAgentHistoryEntry[];
  available: boolean;
  onClose: () => void;
  onRetryInstruction: (instruction: string) => void;
}) {
  const queueRow = useMemo(
    () => queueEntries.find((q) => q.id === runId) ?? null,
    [queueEntries, runId],
  );
  const hist = useMemo(
    () => historyRuns.find((r) => r.id === runId) ?? null,
    [historyRuns, runId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const headlineInstruction =
    hist?.instruction?.trim().length
      ? hist.instruction
      : queueRow?.instructionBody?.trim().length
        ? queueRow.instructionBody
        : queueRow?.instructionTooltip?.trim().length
          ? queueRow.instructionTooltip
          : queueRow?.instructionPreview ?? "";

  const statusLabel =
    hist != null
      ? historyStateLabel(hist.state ?? "ok")
      : queueRow?.status === "waiting"
        ? ko.app.opsAgentQueueWaiting
        : queueRow?.status === "running"
          ? ko.app.opsHistoryStatusRunning
          : ko.app.opsHistoryStatusRunning;

  const tsMs =
    hist != null
      ? (hist.state === "running" || hist.state === "waiting"
          ? hist.updatedAtMs ?? hist.startedAtMs ?? Date.now()
          : hist.finishedAtMs ?? hist.updatedAtMs ?? hist.startedAtMs ?? Date.now())
      : queueRow?.enqueuedAtMs ?? Date.now();

  const hasStreamFields = Boolean(
    hist &&
      (hist.phaseLine ||
        hist.cursorLine ||
        hist.thinkingLine ||
        hist.toolLine ||
        hist.streamText ||
        (hist.toolLog?.trim() ?? "")),
  );

  const histState = hist?.state;
  const showResult =
    hist != null &&
    histState !== "running" &&
    histState !== "waiting" &&
    hist.resultText != null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="news-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="news-modal card ops-queue-progress-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-queue-progress-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header">
          <div className="ops-queue-progress-modal__head-text">
            <h2 id="ops-queue-progress-title">{ko.app.opsQueueProgressModalTitle}</h2>
            <p className="news-modal-sub">
              <span>{statusLabel}</span>
              <span className="ops-queue-progress-meta-sep" aria-hidden>
                {" "}
                ·{" "}
              </span>
              <span>{formatHistoryTs(tsMs)}</span>
              {queueRow != null && typeof queueRow.unifiedQueueSeq === "number" ? (
                <>
                  <span className="ops-queue-progress-meta-sep" aria-hidden>
                    {" "}
                    ·{" "}
                  </span>
                  <span title={ko.app.opsUnifiedQueueSeqTitle}>
                    #{queueRow.unifiedQueueSeq}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            aria-label={ko.app.opsQueueProgressCloseAria}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="news-modal-body ops-queue-progress-modal__body">
          {hist == null && queueRow == null ? (
            <p className="ops-queue-progress-stale" role="status">
              {ko.app.opsQueueProgressStale}
            </p>
          ) : null}

          {!hist && queueRow?.status === "waiting" ? (
            <p className="ops-queue-progress-notice" role="status">
              {ko.app.opsQueueProgressWaitingNotice}
            </p>
          ) : null}

          {headlineInstruction.trim() ? (
            <>
              <p className="ops-management__history-instruction-label">{ko.app.opsInstructionLabel}</p>
              <pre className="ops-management__history-instruction">{headlineInstruction}</pre>
            </>
          ) : null}

          {hasStreamFields && hist ? (
            <div className="ops-management__stream ops-management__stream--archive card">
              <p className="ops-management__stream-title">{ko.app.opsHistoryStreamArchived}</p>
              <OpsManagementLiveStreamContent
                suppressHeadline
                streamHeadlineInstruction={hist.instruction}
                phaseLine={hist.phaseLine ?? ""}
                cursorLine={hist.cursorLine ?? ""}
                toolLine={hist.toolLine ?? ""}
                toolLog={hist.toolLog ?? ""}
                thinkingLine={hist.thinkingLine ?? ""}
                streamText={hist.streamText ?? ""}
              />
            </div>
          ) : null}

          {hist &&
          (hist.state === "running" || hist.state === "waiting") &&
          !hasStreamFields ? (
            <p className="ops-queue-progress-notice" role="status">
              {ko.app.opsQueueProgressLogPending}
            </p>
          ) : null}

          {hist?.error ? (
            <div className="ops-management__history-error-wrap">
              <div className="alert alert--error ops-management__history-error" role="alert">
                {hist.error}
              </div>
              {hist.state !== "rejected" && headlineInstruction.trim() ? (
                <button
                  type="button"
                  className="btn btn--secondary ops-management__history-retry"
                  disabled={!available || Boolean(hist?.workspaceAppliedAtMs)}
                  aria-label={ko.app.opsHistoryRetryFromErrorAria}
                  title={
                    hist?.workspaceAppliedAtMs
                      ? ko.app.opsHistoryRetryBlockedApplied
                      : undefined
                  }
                  onClick={() => {
                    if (hist?.workspaceAppliedAtMs) {
                      window.alert(ko.app.opsHistoryRetryBlockedApplied);
                      return;
                    }
                    onRetryInstruction(headlineInstruction);
                  }}
                >
                  {ko.app.opsHistoryRetryFromError}
                </button>
              ) : null}
            </div>
          ) : null}

          {showResult ? (
            <div className="ops-management__history-result card">
              {hist.statusText ? (
                <p className="ops-management__meta">
                  <span className="ops-management__meta-k">{ko.app.opsStatusLabel}</span>
                  <span className="ops-management__meta-v">{hist.statusText}</span>
                  {hist.runtimeLabel ? (
                    <>
                      <span className="ops-management__meta-sep" aria-hidden>
                        ·
                      </span>
                      <span className="ops-management__meta-k">{ko.app.opsRuntimeLabel}</span>
                      <span className="ops-management__meta-v">{hist.runtimeLabel}</span>
                    </>
                  ) : null}
                  {hist.durationMs != null ? (
                    <>
                      <span className="ops-management__meta-sep" aria-hidden>
                        ·
                      </span>
                      <span className="ops-management__meta-k">{ko.app.opsDurationLabel}</span>
                      <span className="ops-management__meta-v">
                        {(hist.durationMs / 1000).toFixed(1)}s
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
              <p className="ops-management__result-label">{ko.app.opsResultLabel}</p>
              <pre className="ops-management__result">{hist.resultText}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function OpsManagementTab({
  available,
}: {
  available: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState<string | null>(null);

  const [historyRuns, setHistoryRuns] = useState<OpsAgentHistoryEntry[]>([]);
  const [serverQueue, setServerQueue] = useState<OpsAgentQueueEntry[]>([]);
  const [viewerIp, setViewerIp] = useState<string | null>(null);
  const [remotePending, setRemotePending] = useState<OpsCursorAgentPendingResponse | null>(
    null,
  );
  const [progressModalRunId, setProgressModalRunId] = useState<string | null>(null);

  const [mainTab, setMainTab] = useState<"agent" | "fileWork">("agent");
  const [workDraftText, setWorkDraftText] = useState("");
  const [workSaving, setWorkSaving] = useState(false);
  const [workSaveError, setWorkSaveError] = useState<string | null>(null);
  const [recordItems, setRecordItems] = useState<OpsRecordModeItem[]>([]);
  const [recordLoadError, setRecordLoadError] = useState<string | null>(null);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordQueueDetailsOpen, setRecordQueueDetailsOpen] = useState<Record<string, boolean>>(
    () => ({}),
  );
  const [recordActivityEntries, setRecordActivityEntries] = useState<
    OpsRecordModeActivityEntry[]
  >([]);
  const [recordActivityError, setRecordActivityError] = useState<string | null>(null);
  /** PUT/작업 중에는 폴링 병합을 건너뛰어, 삭제 직후 오래된 GET 응답이 행을 되살리는 레이스를 막음 */
  const recordMutationLockRef = useRef(false);

  const displayServerQueue = useMemo(() => serverQueue, [serverQueue]);

  const serverQueueSeqById = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of serverQueue) {
      if (typeof q.unifiedQueueSeq === "number" && Number.isFinite(q.unifiedQueueSeq)) {
        m.set(normalizeOpQueueId(q.id), q.unifiedQueueSeq);
      }
    }
    return m;
  }, [serverQueue]);

  const myQueueJobs = useMemo(() => {
    const ip = viewerIp?.trim() || null;
    const serverMine = ip ? serverQueue.filter((q) => q.requestIp === ip) : [];
    return serverMine;
  }, [serverQueue, viewerIp]);

  const myIpRunningHistory = useMemo(() => {
    if (!viewerIp) return [];
    return historyRuns.filter(
      (r) => r.state === "running" && (r.requestIp ?? "").trim() === viewerIp,
    );
  }, [historyRuns, viewerIp]);

  /** 큐에 이미 같은 id의 "실행 중" 카드가 있으면 이력 쪽 카드는 렌더하지 않음(동일 진행 줄 이중 노출 방지). */
  const myIpQueueRunningIds = useMemo(
    () => new Set(myQueueJobs.filter((q) => q.status === "running").map((q) => q.id)),
    [myQueueJobs],
  );

  const myIpRunningHistoryDeduped = useMemo(
    () => myIpRunningHistory.filter((r) => !myIpQueueRunningIds.has(r.id)),
    [myIpRunningHistory, myIpQueueRunningIds],
  );

  const remotePendingInstruction = String(remotePending?.instruction ?? "").trim();

  /** pending API는 SSE용 복구 안내지만, 실행 큐에 이미 같은 IP의 실행 중 행이 있으면 카드 하나로 충분 */
  const showRemotePendingDupBlock =
    Boolean(remotePendingInstruction) && !myQueueJobs.some((q) => q.status === "running");

  const hasMyIpServerActivity =
    Boolean(remotePendingInstruction) ||
    myQueueJobs.length > 0 ||
    myIpRunningHistory.length > 0;

  /** 예전 초안 저장 키를 비워 둠 (새로고침·재방문 후에도 텍스트는 복원하지 않음) */
  useEffect(() => {
    if (available) clearStockOpsInstructionDraft();
  }, [available]);

  useEffect(() => {
    if (!available) {
      setHistoryRuns([]);
      setServerQueue([]);
      setViewerIp(null);
      setRemotePending(null);
      return;
    }
    let cancelled = false;

    const pullHistory = () => {
      void fetchOpsAgentHistory()
        .then((r) => {
          if (!cancelled) setHistoryRuns(Array.isArray(r.entries) ? r.entries : []);
        })
        .catch(() => {
          /* 다음 폴링에서 재시도 */
        });
    };

    const pullQueue = () => {
      void fetchOpsCursorAgentQueue()
        .then((r) => {
          if (cancelled) return;
          setServerQueue(Array.isArray(r.entries) ? r.entries : []);
          const rawIp = r.viewerIp;
          const ip =
            rawIp === null || rawIp === undefined
              ? null
              : String(rawIp).trim() || null;
          setViewerIp(ip);
        })
        .catch(() => {
          /* 다음 폴링에서 재시도 */
        });
    };

    const pullPending = () => {
      void fetchOpsCursorAgentPending()
        .then((p) => {
          if (cancelled) return;
          setRemotePending(p);
        })
        .catch(() => {
          /* 접근 게이트 복귀 직후 등 — 조용히 무시 */
        });
    };

    const refreshAll = () => {
      pullHistory();
      pullQueue();
      pullPending();
    };

    refreshAll();

    const histId = window.setInterval(pullHistory, HISTORY_POLL_MS);
    const queueId = window.setInterval(pullQueue, AGENT_QUEUE_POLL_MS);
    const pendId = window.setInterval(pullPending, HISTORY_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) refreshAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      window.clearInterval(histId);
      window.clearInterval(queueId);
      window.clearInterval(pendId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [available]);

  useEffect(() => {
    if (!available || mainTab !== "fileWork") {
      return;
    }
    let cancelled = false;
    const pull = () => {
      void fetchOpsRecordMode()
        .then((r) => {
          if (cancelled) return;
          const rsrv = Array.isArray(r.items) ? r.items : [];
          setRecordLoadError(null);
          setRecordItems((prev) => {
            if (recordMutationLockRef.current) return prev;
            return mergeRecordModePoll(prev, rsrv);
          });
        })
        .catch(() => {
          if (!cancelled) setRecordLoadError(ko.app.opsRecordModeLoadError);
        });
    };
    pull();
    const id = window.setInterval(pull, RECORD_MODE_QUEUE_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") pull();
    };
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) pull();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [available, mainTab]);

  useEffect(() => {
    if (!available) {
      setRecordActivityEntries([]);
      setRecordActivityError(null);
      return;
    }
    if (mainTab !== "fileWork") {
      return;
    }
    let cancelled = false;
    const pull = () => {
      void fetchOpsRecordModeActivity()
        .then((r) => {
          if (cancelled) return;
          setRecordActivityEntries(Array.isArray(r.entries) ? r.entries : []);
          setRecordActivityError(null);
        })
        .catch(() => {
          if (!cancelled) setRecordActivityError(ko.app.opsFileRequestHistoryLoadError);
        });
    };
    pull();
    const id = window.setInterval(pull, FILE_ACTIVITY_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [available, mainTab]);

  const enqueueOrRunInstruction = useCallback(
    async (ins: string): Promise<boolean> => {
      if (!available) return false;
      const n = ins.trim();
      if (!n) return false;
      setSubmitting(true);
      setError(null);
      setResultText(null);
      setStatusText(null);
      setDurationMs(null);
      setRuntimeLabel(null);
      try {
        await fetchOpsCursorAgentStream(n, (ev) => {
          if (ev.type === "phase") {
            setStatusText(ev.message);
          } else if (ev.type === "cursor_status") {
            const d = ev.detail?.trim() ? ` · ${ev.detail.trim()}` : "";
            setStatusText(`${ev.status}${d}`.slice(0, 280));
          } else if (ev.type === "done") {
            setResultText(ev.result);
            setStatusText(ev.status);
            setDurationMs(
              typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs)
                ? ev.durationMs
                : null,
            );
            setRuntimeLabel(typeof ev.runtime === "string" ? ev.runtime : null);
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        });
        return true;
      } catch (e) {
        setResultText(null);
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [available],
  );

  /** 메인 폼 `submitting`과 분리 — 서버 FIFO에만 쌓고, 여러 건 재큐잉 가능 */
  const enqueueAgentInstructionOnServerOnly = useCallback((ins: string) => {
    if (!available) return;
    const n = ins.trim();
    if (!n) return;
    void fetchOpsCursorAgentStream(n, (ev) => {
      if (ev.type === "error") {
        throw new Error(ev.message);
      }
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [available]);

  const retryFromHistoryPanel = useCallback(
    (ins: string) => {
      const t = ins.trim();
      if (!t) return;
      setInstruction(t);
      enqueueAgentInstructionOnServerOnly(t);
    },
    [enqueueAgentInstructionOnServerOnly],
  );

  const retryFromQueueModal = useCallback(
    (ins: string) => {
      const t = ins.trim();
      if (!t) return;
      setInstruction(t);
      enqueueAgentInstructionOnServerOnly(t);
      setProgressModalRunId(null);
    },
    [enqueueAgentInstructionOnServerOnly],
  );

  const clearHistory = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm(ko.app.opsHistoryClearConfirm)) {
      return;
    }
    try {
      await deleteOpsAgentHistory();
      setHistoryRuns([]);
    } catch {
      /* 다음 폴링으로 동기화 */
    }
  }, []);

  const deleteHistoryEntry = useCallback(async (run: OpsAgentHistoryEntry) => {
    const msg =
      run.state === "running" || run.state === "waiting"
        ? ko.app.opsHistoryDeleteRunningConfirm
        : ko.app.opsHistoryDeleteEntryConfirm;
    if (typeof window !== "undefined" && !window.confirm(msg)) {
      return;
    }
    try {
      await deleteOpsAgentHistoryEntry(run.id);
      setHistoryRuns((prev) => prev.filter((r) => r.id !== run.id));
    } catch {
      void fetchOpsAgentHistory()
        .then((r) => setHistoryRuns(Array.isArray(r.entries) ? r.entries : []))
        .catch(() => {
          /* 폴링으로 보완 */
        });
    }
  }, []);

  const setWorkspaceApplied = useCallback(async (run: OpsAgentHistoryEntry, applied: boolean) => {
    try {
      const r = await postOpsAgentHistoryWorkspaceApplied(run.id, applied);
      setHistoryRuns(Array.isArray(r.entries) ? r.entries : []);
    } catch {
      window.alert(ko.app.opsHistoryMarkAppliedError);
    }
  }, []);

  const recordHasRunning = useMemo(
    () => recordItems.some((x) => x.status === "running"),
    [recordItems],
  );

  const recordStatusLabel = useCallback((s: OpsRecordModeItem["status"]) => {
    if (s === "running") return ko.app.opsRecordModeStatusRunning;
    if (s === "done") return ko.app.opsRecordModeStatusDone;
    if (s === "error") return ko.app.opsRecordModeStatusError;
    return ko.app.opsRecordModeStatusPending;
  }, []);

  const addRecordItem = useCallback(() => {
    if (!available || workSaving) return;
    const id = newLocalQueueItemId();
    setRecordQueueDetailsOpen((m) => ({ ...m, [id]: true }));
    const row: OpsRecordModeItem = {
      id,
      instruction: "",
      status: "pending",
      createdAtMs: Date.now(),
    };
    setRecordItems((prev) => [...prev, row]);
  }, [available, workSaving]);

  /** 작성 칸(한 줄 추가) + 목록 편집을 한 번에 서버에 반영 */
  const applyFileWorkQueue = useCallback(async () => {
    if (!available || workSaving || recordSaving || recordHasRunning) return;
    const draft = workDraftText.trim();
    recordMutationLockRef.current = true;
    setWorkSaving(true);
    setWorkSaveError(null);
    setRecordLoadError(null);
    try {
      let merged = recordItems;
      if (draft) {
        const r = await postOpsRecordModeJob(draft);
        const srv = Array.isArray(r.items) ? r.items : [];
        merged = mergeRecordModePoll(recordItems, srv);
        setRecordItems(merged);
        setWorkDraftText("");
      }
      const putR = await putOpsRecordMode(merged);
      setRecordItems(Array.isArray(putR.items) ? putR.items : merged);
      setRecordQueueDetailsOpen({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setWorkSaveError(msg || ko.app.opsWorkApplyError);
    } finally {
      recordMutationLockRef.current = false;
      setWorkSaving(false);
    }
  }, [available, workSaving, recordSaving, recordHasRunning, recordItems, workDraftText]);

  const removeRecordItem = useCallback(
    async (id: string) => {
      if (!available || recordSaving) return;
      const nid = normalizeOpQueueId(id);
      const target = recordItems.find((x) => normalizeOpQueueId(x.id) === nid);
      if (target?.status === "running") return;
      const previous = recordItems;
      const next = previous.filter((x) => normalizeOpQueueId(x.id) !== nid);
      if (next.length === previous.length) return;
      recordMutationLockRef.current = true;
      setRecordSaving(true);
      setRecordLoadError(null);
      setRecordItems(next);
      try {
        const r = await putOpsRecordMode(next);
        setRecordItems(Array.isArray(r.items) ? r.items : next);
        setRecordQueueDetailsOpen((m) => {
          if (!(id in m) && !(nid in m)) return m;
          const o = { ...m };
          delete o[id];
          if (nid !== id) delete o[nid];
          return o;
        });
      } catch {
        setRecordItems(previous);
        setRecordLoadError(ko.app.opsRecordModeSaveError);
      } finally {
        recordMutationLockRef.current = false;
        setRecordSaving(false);
      }
    },
    [available, recordSaving, recordItems],
  );

  const updateRecordInstruction = useCallback((id: string, text: string) => {
    setRecordItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, instruction: text } : x)),
    );
  }, []);

  const requeueRecordItem = useCallback((id: string) => {
    setRecordItems((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, status: "pending" as const, error: null, lockedAtMs: null } : x,
      ),
    );
  }, []);

  const handleMainSubmit = useCallback(async () => {
    if (!available || submitting) return;
    const ins = instruction.trim();
    if (!ins) return;
    setInstruction("");
    const ok = await enqueueOrRunInstruction(ins);
    if (!ok) setInstruction(ins);
  }, [available, submitting, instruction, enqueueOrRunInstruction]);

  const showMyIpJobsPanel = hasMyIpServerActivity || submitting;

  return (
    <div className="ops-management ops-management--split">
      <div className="ops-management__main">
        {available && mainTab === "agent" ? (
          <>
            <section
              className="ops-management__server-queue card"
              aria-label={ko.app.opsAgentQueueSubtitle}
            >
              <p className="ops-management__server-queue-sub">{ko.app.opsAgentQueueSubtitle}</p>
              <div
                className="ops-agent-queue-track ops-management__server-queue-track"
                role="group"
                aria-label={ko.app.opsAgentQueueSubtitle}
                aria-live="polite"
                aria-relevant="additions removals"
              >
                {displayServerQueue.length === 0 ? (
                  <span className="ops-management__server-queue-empty">{ko.app.opsAgentQueueEmpty}</span>
                ) : (
                  displayServerQueue.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      className={`ops-agent-queue-card ops-agent-queue-card--${q.status}`}
                      aria-label={ko.app.opsQueueProgressModalTitle + ": " + (q.instructionPreview.trim() || "—")}
                      onClick={() => setProgressModalRunId(q.id)}
                    >
                      <div className="ops-agent-queue-card__top">
                        <OpsQueueUnifiedSeqBadge seq={q.unifiedQueueSeq} />
                        <span className="ops-agent-queue-card__status">
                          {q.status === "running"
                            ? ko.app.opsHistoryStatusRunning
                            : ko.app.opsAgentQueueWaiting}
                        </span>
                        <span
                          className="ops-agent-queue-card__ip ops-management__stream-v--mono"
                          title={ko.app.opsHistoryRequestIp}
                        >
                          {q.requestIp.trim() ? q.requestIp : "—"}
                        </span>
                      </div>
                      <p className="ops-agent-queue-card__preview" title={q.instructionTooltip ?? q.instructionPreview}>
                        {q.instructionPreview.trim() ? q.instructionPreview : "—"}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>

            {showMyIpJobsPanel ? (
              <section
                className="ops-management__my-ip-jobs ops-management__my-ip-jobs--inline"
                aria-label={ko.app.opsMyIpJobsTitle}
              >
                <div className="ops-management__my-ip-bubble-body">
                  <p className="ops-management__my-ip-title">{ko.app.opsMyIpJobsTitle}</p>
                  <p className="ops-management__my-ip-hint">{ko.app.opsMyIpJobsHint}</p>
                  {viewerIp ? (
                    <p className="ops-management__my-ip-line ops-management__stream-v--mono">
                      <span className="ops-management__my-ip-k">{ko.app.opsHistoryRequestIp}</span>
                      {viewerIp}
                    </p>
                  ) : (
                    <p className="ops-management__my-ip-none" role="status">
                      {ko.app.opsMyIpNoViewerIp}
                    </p>
                  )}
                  {viewerIp && !hasMyIpServerActivity ? (
                    <p className="ops-management__my-ip-none" role="status">
                      {ko.app.opsMyIpJobsNone}
                    </p>
                  ) : null}

                  {showRemotePendingDupBlock ? (
                    <div
                      className="ops-management__my-ip-pending"
                      role="status"
                      aria-live="polite"
                    >
                      <span className="ops-management__my-ip-pending-badge">
                        {ko.app.opsRemotePendingBadge}
                      </span>
                      <span className="ops-management__my-ip-pending-text">{ko.app.opsRemotePendingHint}</span>
                    </div>
                  ) : null}

                  {myIpRunningHistoryDeduped.length > 0 ? (
                    <div className="ops-management__my-ip-running-block">
                      <p className="ops-management__my-ip-subtitle">{ko.app.opsMyIpHistoryRunning}</p>
                      <div
                        className="ops-agent-queue-track"
                        role="group"
                        aria-label={ko.app.opsMyIpHistoryRunning}
                      >
                        {myIpRunningHistoryDeduped.map((run) => {
                          const line =
                            run.instruction.split(/\r?\n/).find(Boolean) ?? run.instruction;
                          const prev =
                            line.length > 200 ? `${line.slice(0, 197)}…` : line;
                          return (
                            <button
                              key={run.id}
                              type="button"
                              className="ops-agent-queue-card ops-agent-queue-card--running"
                              aria-label={`${ko.app.opsMyIpHistoryRunning}: ${prev.trim() || "—"}`}
                              onClick={() => setProgressModalRunId(run.id)}
                            >
                              <div className="ops-agent-queue-card__top">
                                <OpsQueueUnifiedSeqBadge
                                  seq={serverQueueSeqById.get(normalizeOpQueueId(run.id)) ?? null}
                                />
                                <span className="ops-agent-queue-card__status">
                                  {ko.app.opsHistoryStatusRunning}
                                </span>
                                <span className="ops-agent-queue-card__meta ops-management__stream-v--mono">
                                  {formatHistoryTs(
                                    run.updatedAtMs ?? run.startedAtMs ?? Date.now(),
                                  )}
                                </span>
                              </div>
                              <p className="ops-agent-queue-card__preview" title={line}>
                                {prev.trim() ? prev : "—"}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {myQueueJobs.length > 0 ? (
                    <div
                      className="ops-agent-queue-track ops-management__my-ip-queue-track"
                      role="group"
                      aria-label={ko.app.opsAgentQueueSubtitle}
                    >
                      {myQueueJobs.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          className={`ops-agent-queue-card ops-agent-queue-card--${q.status}`}
                          aria-label={`${ko.app.opsMyIpJobsTitle}: ${q.instructionPreview.trim() || "—"}`}
                          onClick={() => setProgressModalRunId(q.id)}
                        >
                          <div className="ops-agent-queue-card__top">
                            <OpsQueueUnifiedSeqBadge seq={q.unifiedQueueSeq} />
                            <span className="ops-agent-queue-card__status">
                              {q.status === "running"
                                ? ko.app.opsHistoryStatusRunning
                                : ko.app.opsAgentQueueWaiting}
                            </span>
                          </div>
                          <p
                            className="ops-agent-queue-card__preview"
                            title={q.instructionTooltip ?? q.instructionPreview}
                          >
                            {q.instructionPreview.trim() ? q.instructionPreview : "—"}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {available && mainTab === "fileWork" ? (
          <>
            <section
              className="ops-management__server-queue card ops-management__file-request-queue"
              aria-label={ko.app.opsWorkSectionRequests}
            >
              <p className="ops-management__server-queue-sub">{ko.app.opsWorkSectionRequests}</p>
              <div
                className="ops-agent-queue-track ops-management__server-queue-track"
                role="group"
                aria-label={ko.app.opsWorkSectionRequests}
                aria-live="polite"
                aria-relevant="additions removals"
              >
                {recordItems.length === 0 ? (
                  <span className="ops-management__server-queue-empty">{ko.app.opsRecordModeEmpty}</span>
                ) : (
                  recordItems.map((it, idx) => {
                    const cardClass = recordModeItemQueueCardClass(it.status);
                    const ro =
                      it.status === "running" ||
                      it.status === "done" ||
                      !available ||
                      recordSaving;
                    const line =
                      it.instruction.split(/\r?\n/).find((l) => l.trim()) ?? it.instruction;
                    const previewText = line.trim() ? line : "—";
                    const ts = it.updatedAtMs ?? it.createdAtMs;
                    const ixLabel =
                      typeof it.unifiedQueueSeq === "number" && Number.isFinite(it.unifiedQueueSeq)
                        ? it.unifiedQueueSeq
                        : idx + 1;
                    return (
                      <div
                        key={it.id}
                        className={`ops-agent-queue-card ops-agent-queue-card--${cardClass} ops-management__file-request-queue-card`}
                      >
                        <div className="ops-agent-queue-card__top">
                          <OpsQueueUnifiedSeqBadge seq={it.unifiedQueueSeq} />
                          <span className="ops-agent-queue-card__status">
                            {recordStatusLabel(it.status)}
                          </span>
                          <span className="ops-agent-queue-card__meta ops-management__stream-v--mono">
                            {formatHistoryTs(ts)}
                          </span>
                        </div>
                        <p
                          className="ops-agent-queue-card__preview"
                          title={it.instruction.trim() ? it.instruction : undefined}
                        >
                          {previewText}
                        </p>
                        <div className="ops-management__file-request-queue-card-actions">
                          {it.status === "error" || it.status === "done" ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={ko.app.opsRecordModeRequeueAria}
                              disabled={!available || recordSaving || recordHasRunning}
                              onClick={() => requeueRecordItem(it.id)}
                            >
                              {ko.app.opsRecordModeRequeue}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={ko.app.opsRecordModeRemoveAria}
                            disabled={it.status === "running" || !available || recordSaving}
                            onClick={() => void removeRecordItem(it.id)}
                          >
                            {ko.app.opsRecordModeRemove}
                          </button>
                        </div>
                        <details
                          className="ops-management__file-request-queue-card-details"
                          open={Boolean(recordQueueDetailsOpen[it.id])}
                          onToggle={(e) => {
                            const id = it.id;
                            const nextOpen = e.currentTarget.open;
                            setRecordQueueDetailsOpen((m) => ({ ...m, [id]: nextOpen }));
                          }}
                        >
                          <summary className="ops-management__file-request-queue-card-details-sum">
                            <span className="ops-management__file-request-queue-card-sum-row">
                              <span className="ops-management__file-request-queue-card-sum-k">
                                {ko.app.opsRecordModeQueueRankLabel}
                              </span>
                              <span className="ops-management__stream-v--mono ops-management__file-request-queue-card-sum-v">
                                #{ixLabel}
                              </span>
                            </span>
                            <span className="ops-management__file-request-queue-card-sum-row ops-management__file-request-queue-card-sum-row--label">
                              <span className="ops-management__file-request-queue-card-sum-k">
                                {ko.app.opsInstructionLabel}
                              </span>
                            </span>
                          </summary>
                          <textarea
                            id={`ops-record-${it.id}`}
                            className="ops-management__textarea ops-management__textarea--sm ops-management__file-request-queue-card-textarea"
                            value={it.instruction}
                            onChange={(e) => updateRecordInstruction(it.id, e.target.value)}
                            placeholder={ko.app.opsRecordModePlaceholder}
                            rows={4}
                            disabled={ro}
                            spellCheck={false}
                            aria-label={`${ko.app.opsRecordModeItemLabel} · ${ko.app.opsRecordModeQueueRankLabel} ${ixLabel}`}
                          />
                        </details>
                        {it.error ? (
                          <pre className="ops-management__record-err" role="alert">
                            {it.error}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
            {recordLoadError ? (
              <div
                className="alert alert--error ops-management__record-alert ops-management__file-request-queue-load-err"
                role="alert"
              >
                {recordLoadError}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="panel-head ops-management__head">
          <h3 className="ops-management__title">{ko.app.opsPanelTitle}</h3>
          <div
            className="market-tabs ops-management__subtabs"
            role="tablist"
            aria-label={ko.app.opsPanelTitle}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "agent"}
              className={mainTab === "agent" ? "market-tab active" : "market-tab"}
              onClick={() => setMainTab("agent")}
            >
              {ko.app.opsMainTabAgent}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "fileWork"}
              className={mainTab === "fileWork" ? "market-tab active" : "market-tab"}
              onClick={() => setMainTab("fileWork")}
            >
              {ko.app.opsMainTabFileWork}
            </button>
          </div>
        </div>

        {!available ? (
          <div className="alert alert--error ops-management__banner" role="status">
            {ko.app.opsNoKey}
          </div>
        ) : null}

        {mainTab === "agent" ? (
          <>
            <div className="ops-management__fields">
              <label className="ops-management__label" htmlFor="ops-instruction">
                {ko.app.opsInstructionLabel}
              </label>
              <textarea
                id="ops-instruction"
                className="ops-management__textarea ops-management__textarea--request"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.repeat) return;
                  if (!(e.ctrlKey || e.metaKey)) return;
                  e.preventDefault();
                  void handleMainSubmit();
                }}
                placeholder={ko.app.opsInstructionPlaceholder}
                rows={10}
                disabled={!available}
                spellCheck={false}
              />

              <div className="ops-management__actions">
                <button
                  type="button"
                  className="btn btn--primary ops-management__submit"
                  disabled={!available || submitting || !instruction.trim()}
                  onClick={() => void handleMainSubmit()}
                >
                  {ko.app.opsSubmit}
                </button>
              </div>
              <p className="ops-management__muted" style={{ marginTop: "0.65rem" }}>
                {ko.app.opsAgentServerQueueHint}
              </p>
            </div>

            {error ? (
              <div className="ops-management__live-error-wrap">
                <div className="alert alert--error ops-management__out" role="alert">
                  {error}
                </div>
                {instruction.trim() ? (
                  <button
                    type="button"
                    className="btn btn--secondary ops-management__history-retry"
                    disabled={!available}
                    aria-label={ko.app.opsLiveErrorRetryAria}
                    onClick={() => {
                      setError(null);
                      enqueueAgentInstructionOnServerOnly(instruction);
                    }}
                  >
                    {ko.app.opsHistoryRetryFromError}
                  </button>
                ) : null}
              </div>
            ) : null}

            {resultText != null && !error ? (
              <div className="ops-management__out card">
                {statusText ? (
                  <p className="ops-management__meta">
                    <span className="ops-management__meta-k">{ko.app.opsStatusLabel}</span>
                    <span className="ops-management__meta-v">{statusText}</span>
                    {runtimeLabel ? (
                      <>
                        <span className="ops-management__meta-sep" aria-hidden>
                          ·
                        </span>
                        <span className="ops-management__meta-k">{ko.app.opsRuntimeLabel}</span>
                        <span className="ops-management__meta-v">{runtimeLabel}</span>
                      </>
                    ) : null}
                    {durationMs != null ? (
                      <>
                        <span className="ops-management__meta-sep" aria-hidden>
                          ·
                        </span>
                        <span className="ops-management__meta-k">{ko.app.opsDurationLabel}</span>
                        <span className="ops-management__meta-v">
                          {(durationMs / 1000).toFixed(1)}s
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="ops-management__result-label">{ko.app.opsResultLabel}</p>
                <pre className="ops-management__result">{resultText}</pre>
              </div>
            ) : null}

          </>
        ) : null}
        {mainTab === "fileWork" ? (
          <div className="ops-management__record">
            <label className="ops-management__label" htmlFor="ops-work-draft">
              {ko.app.opsWorkWriteLabel}
            </label>
            <textarea
              id="ops-work-draft"
              className="ops-management__textarea ops-management__textarea--request"
              value={workDraftText}
              onChange={(e) => {
                setWorkDraftText(e.target.value);
                if (workSaveError) setWorkSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.repeat) return;
                if (!(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                void applyFileWorkQueue();
              }}
              placeholder={ko.app.opsInstructionPlaceholder}
              rows={10}
              disabled={!available || workSaving || recordSaving}
              spellCheck={false}
            />
            {workSaveError ? (
              <div className="alert alert--error ops-management__record-alert" role="alert">
                {workSaveError}
              </div>
            ) : null}
            <div className="ops-management__actions">
              <button
                type="button"
                className="btn btn--primary ops-management__submit"
                disabled={!available || workSaving || recordSaving || recordHasRunning}
                onClick={() => void applyFileWorkQueue()}
              >
                {workSaving ? ko.app.opsWorkApplying : ko.app.opsWorkApplyQueue}
              </button>
            </div>

            <div className="ops-management__record-actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!available || workSaving || recordSaving}
                onClick={() => addRecordItem()}
              >
                {ko.app.opsRecordModeAdd}
              </button>
            </div>
            {recordHasRunning ? (
              <p className="ops-management__muted ops-management__record-blocked">
                {ko.app.opsRecordModeSaveBlocked}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {mainTab === "agent" ? (
        <aside className="ops-management__aside card" aria-label={ko.app.opsHistoryTitle}>
        <div className="ops-management__history-bar">
          <h4 className="ops-management__history-title">{ko.app.opsHistoryTitle}</h4>
          {historyRuns.length > 0 ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm ops-management__history-clear"
              onClick={() => void clearHistory()}
            >
              {ko.app.opsHistoryClearAll}
            </button>
          ) : null}
        </div>
        {historyRuns.length === 0 ? (
          <p className="ops-management__history-empty">{ko.app.opsHistoryEmpty}</p>
        ) : (
          <ul className="ops-management__history-list">
            {historyRuns.map((run) => {
              const state = run.state ?? "ok";
              const summaryLine =
                run.instruction.split(/\r?\n/).find(Boolean) ?? run.instruction;
              const header =
                summaryLine.length > 120 ? `${summaryLine.slice(0, 117)}…` : summaryLine;
              const showArchiveStream = Boolean(
                run.phaseLine ||
                  run.cursorLine ||
                  run.thinkingLine ||
                  run.toolLine ||
                  run.streamText ||
                  (run.toolLog?.trim() ?? ""),
              );
              const tsMs =
                state === "running" || state === "waiting"
                  ? (run.updatedAtMs ?? run.startedAtMs ?? Date.now())
                  : (run.finishedAtMs ?? run.updatedAtMs ?? run.startedAtMs ?? Date.now());
              const badgeClass =
                state === "running"
                  ? "ops-history__badge--pending"
                  : state === "waiting"
                    ? "ops-history__badge--waiting"
                    : state === "ok"
                      ? "ops-history__badge--ok"
                      : state === "rejected"
                        ? "ops-history__badge--rejected"
                        : "ops-history__badge--err";

              return (
                <li key={run.id} className="ops-management__history-item">
                  <details className="ops-management__history-details">
                    <summary className="ops-management__history-summary">
                      <span className={`ops-history__badge ${badgeClass}`}>
                        {historyStateLabel(state)}
                      </span>
                      <span className="ops-management__history-when">{formatHistoryTs(tsMs)}</span>
                      {run.requestIp ? (
                        <span
                          className="ops-management__history-ip-inline ops-management__stream-v--mono"
                          title={ko.app.opsHistoryRequestIp}
                        >
                          {run.requestIp}
                        </span>
                      ) : null}
                      {run.workspaceAppliedAtMs ? (
                        <span
                          className="ops-history__badge ops-history__badge--applied"
                          title={formatHistoryTs(run.workspaceAppliedAtMs)}
                        >
                          {ko.app.opsHistoryWorkspaceAppliedBadge}
                        </span>
                      ) : null}
                      <span className="ops-management__history-snippet">{header}</span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm ops-management__history-delete"
                        aria-label={ko.app.opsHistoryDeleteEntryAria}
                        onMouseDown={(e) => {
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void deleteHistoryEntry(run);
                        }}
                      >
                        {ko.app.opsHistoryDeleteEntry}
                      </button>
                    </summary>

                    {state === "running" || state === "waiting" ? (
                      <p className="ops-management__history-instruction-muted" role="note">
                        {ko.app.opsHistoryRunningNoReplayHint}
                      </p>
                    ) : (
                      <>
                        <p className="ops-management__history-instruction-label">
                          {ko.app.opsHistoryInstructionReplay}
                        </p>
                        <pre className="ops-management__history-instruction">{run.instruction}</pre>
                      </>
                    )}

                    {state !== "running" && state !== "waiting" ? (
                      <div className="ops-management__history-applied-row">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={!available}
                          onClick={() => void setWorkspaceApplied(run, !run.workspaceAppliedAtMs)}
                        >
                          {run.workspaceAppliedAtMs
                            ? ko.app.opsHistoryUnmarkWorkspaceApplied
                            : ko.app.opsHistoryMarkWorkspaceApplied}
                        </button>
                      </div>
                    ) : null}

                    {showArchiveStream ? (
                      <div className="ops-management__stream ops-management__stream--archive card">
                        <p className="ops-management__stream-title">
                          {ko.app.opsHistoryStreamArchived}
                        </p>
                        {run.phaseLine ? (
                          <p className="ops-management__stream-row">
                            <span className="ops-management__stream-k">{ko.app.opsStreamPhase}</span>
                            <span className="ops-management__stream-v">{run.phaseLine}</span>
                          </p>
                        ) : null}
                        {run.cursorLine ? (
                          <p className="ops-management__stream-row">
                            <span className="ops-management__stream-k">
                              {ko.app.opsStreamCursorStatus}
                            </span>
                            <span className="ops-management__stream-v ops-management__stream-v--mono">
                              {run.cursorLine}
                            </span>
                          </p>
                        ) : null}
                        {run.toolLine ? (
                          <p className="ops-management__stream-row">
                            <span className="ops-management__stream-k">{ko.app.opsStreamTool}</span>
                            <span className="ops-management__stream-v ops-management__stream-v--mono">
                              {run.toolLine}
                            </span>
                          </p>
                        ) : null}
                        {run.thinkingLine ? (
                          <p className="ops-management__stream-row ops-management__stream-row--thinking">
                            <span className="ops-management__stream-k">
                              {ko.app.opsStreamThinking}
                            </span>
                            <span className="ops-management__stream-v">{run.thinkingLine}</span>
                          </p>
                        ) : null}
                        {run.streamText ? (
                          <pre className="ops-management__stream-pre">{run.streamText}</pre>
                        ) : null}
                        {run.toolLog?.trim() ? (
                          <>
                            <p className="ops-management__stream-title ops-management__stream-title--sub">
                              {ko.app.opsHistoryToolLogTitle}
                            </p>
                            <pre className="ops-management__stream-pre ops-management__stream-pre--toollog">
                              {run.toolLog.trim()}
                            </pre>
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {run.error ? (
                      <div className="ops-management__history-error-wrap">
                        <div className="alert alert--error ops-management__history-error" role="alert">
                          {run.error}
                        </div>
                        {state !== "running" &&
                        state !== "waiting" &&
                        state !== "rejected" &&
                        run.instruction.trim().length > 0 ? (
                          <button
                            type="button"
                            className="btn btn--secondary ops-management__history-retry"
                            disabled={!available || Boolean(run.workspaceAppliedAtMs)}
                            aria-label={ko.app.opsHistoryRetryFromErrorAria}
                            title={
                              run.workspaceAppliedAtMs
                                ? ko.app.opsHistoryRetryBlockedApplied
                                : undefined
                            }
                            onClick={() => {
                              if (run.workspaceAppliedAtMs) {
                                window.alert(ko.app.opsHistoryRetryBlockedApplied);
                                return;
                              }
                              retryFromHistoryPanel(run.instruction);
                            }}
                          >
                            {ko.app.opsHistoryRetryFromError}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {run.resultText != null &&
                    state !== "running" &&
                    state !== "waiting" ? (
                      <div className="ops-management__history-result card">
                        {run.statusText ? (
                          <p className="ops-management__meta">
                            <span className="ops-management__meta-k">{ko.app.opsStatusLabel}</span>
                            <span className="ops-management__meta-v">{run.statusText}</span>
                            {run.runtimeLabel ? (
                              <>
                                <span className="ops-management__meta-sep" aria-hidden>
                                  ·
                                </span>
                                <span className="ops-management__meta-k">
                                  {ko.app.opsRuntimeLabel}
                                </span>
                                <span className="ops-management__meta-v">{run.runtimeLabel}</span>
                              </>
                            ) : null}
                            {run.durationMs != null ? (
                              <>
                                <span className="ops-management__meta-sep" aria-hidden>
                                  ·
                                </span>
                                <span className="ops-management__meta-k">
                                  {ko.app.opsDurationLabel}
                                </span>
                                <span className="ops-management__meta-v">
                                  {(run.durationMs / 1000).toFixed(1)}s
                                </span>
                              </>
                            ) : null}
                          </p>
                        ) : null}
                        <p className="ops-management__result-label">{ko.app.opsResultLabel}</p>
                        <pre className="ops-management__result">{run.resultText}</pre>
                      </div>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        </aside>
      ) : null}
      {mainTab === "fileWork" ? (
        <aside
          className="ops-management__aside card"
          aria-label={ko.app.opsFileRequestHistoryTitle}
        >
          <div className="ops-management__history-bar">
            <h4 className="ops-management__history-title">
              {ko.app.opsFileRequestHistoryTitle}
            </h4>
          </div>
          <p className="ops-management__muted" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
            {ko.app.opsFileRequestHistoryHint}
          </p>
          {recordActivityError ? (
            <div className="alert alert--error" role="alert">
              {recordActivityError}
            </div>
          ) : recordActivityEntries.length === 0 ? (
            <p className="ops-management__history-empty">{ko.app.opsFileRequestHistoryEmpty}</p>
          ) : (
            <ul className="ops-management__history-list ops-management__file-request-activity-list">
              {recordActivityEntries.map((ent, idx) => {
                const label =
                  ent.event === "start"
                    ? ko.app.opsFileRequestActivityStart
                    : ent.event === "ok"
                      ? ko.app.opsFileRequestActivityOk
                      : ko.app.opsFileRequestActivityError;
                const badgeClass =
                  ent.event === "start"
                    ? "ops-history__badge--waiting"
                    : ent.event === "ok"
                      ? "ops-history__badge--ok"
                      : "ops-history__badge--err";
                let tsMs = Date.now();
                const p = Date.parse(ent.iso);
                if (Number.isFinite(p)) tsMs = p;
                const rawIns = ent.instruction ?? "";
                const insLine =
                  rawIns.split(/\r?\n/).find((l) => l.trim()) ?? rawIns;
                const insPrev =
                  insLine.length > 160 ? `${insLine.slice(0, 157)}…` : insLine;
                const key = `${idx}-${ent.iso}-${ent.id}-${ent.event}`;
                const idShort =
                  ent.id.length > 14 ? `${ent.id.slice(0, 10)}…` : ent.id;
                return (
                  <li
                    key={key}
                    className="ops-management__history-item ops-management__file-request-activity-item"
                  >
                    <div className="ops-management__file-request-activity-head">
                      <span className={`ops-history__badge ${badgeClass}`}>{label}</span>
                      <span className="ops-management__history-when">
                        {formatHistoryTs(tsMs)}
                      </span>
                      <span
                        className="ops-management__file-request-activity-id ops-management__stream-v--mono"
                        title={`${ko.app.opsFileRequestActivityIdLabel}: ${ent.id}`}
                      >
                        {idShort}
                      </span>
                    </div>
                    {insPrev.trim() ? (
                      <pre className="ops-management__file-request-activity-instruction">
                        {insPrev.trim()}
                      </pre>
                    ) : null}
                    {ent.message?.trim() ? (
                      <pre
                        className="ops-management__file-request-activity-message"
                        role={ent.event === "error" ? "alert" : undefined}
                      >
                        {ent.message.trim()}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      ) : null}
      {progressModalRunId ? (
        <OpsAgentQueueProgressModal
          runId={progressModalRunId}
          queueEntries={displayServerQueue}
          historyRuns={historyRuns}
          available={available}
          onClose={() => setProgressModalRunId(null)}
          onRetryInstruction={retryFromQueueModal}
        />
      ) : null}
    </div>
  );
}
