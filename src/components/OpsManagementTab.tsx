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
  postOpsCursorAgentStreamCancel,
  type OpsAgentHistoryEntry,
  type OpsAgentQueueEntry,
  type OpsCursorAgentPendingResponse,
} from "../api";
import { ko } from "../i18n/ko";

const HISTORY_POLL_MS = 2000;
const AGENT_QUEUE_POLL_MS = 5000;

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
  return ko.app.opsHistoryStatusOk;
}

function streamHeadlineFromInstruction(text: string, maxChars: number): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const t = line.trim();
  if (!t) return "";
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

function OpsManagementLiveStreamContent({
  streamHeadlineInstruction,
  phaseLine,
  cursorLine,
  toolLine,
  thinkingLine,
  streamText,
  suppressHeadline = false,
}: {
  streamHeadlineInstruction: string;
  phaseLine: string;
  cursorLine: string;
  toolLine: string;
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
  onClose,
}: {
  runId: string;
  queueEntries: OpsAgentQueueEntry[];
  historyRuns: OpsAgentHistoryEntry[];
  onClose: () => void;
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
        hist.streamText),
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
            <div className="alert alert--error ops-management__history-error" role="alert">
              {hist.error}
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
  const [streamHeadlineInstruction, setStreamHeadlineInstruction] = useState("");
  const [nextInstruction, setNextInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState<string | null>(null);

  const [phaseLine, setPhaseLine] = useState("");
  const [cursorLine, setCursorLine] = useState("");
  const [thinkingLine, setThinkingLine] = useState("");
  const [toolLine, setToolLine] = useState("");
  const [streamText, setStreamText] = useState("");

  const [historyRuns, setHistoryRuns] = useState<OpsAgentHistoryEntry[]>([]);
  const [serverQueue, setServerQueue] = useState<OpsAgentQueueEntry[]>([]);
  const [viewerIp, setViewerIp] = useState<string | null>(null);
  const [remotePending, setRemotePending] = useState<OpsCursorAgentPendingResponse | null>(
    null,
  );
  const [progressModalRunId, setProgressModalRunId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const pendingAfterRef = useRef<string[]>([]);
  /** 스트림 세션(큐 연속 실행 포함) 동안 중복 POST 방지 — `submitting`보다 먼저 동기적으로 막는다 */
  const streamSessionLockRef = useRef(false);
  const runStreamImpl = useRef<(ins: string, opts?: { chained?: boolean }) => Promise<void>>(
    async () => {},
  );

  const myQueueJobs = useMemo(() => {
    if (!viewerIp) return [];
    return serverQueue.filter((q) => q.requestIp === viewerIp);
  }, [serverQueue, viewerIp]);

  const myIpRunningHistory = useMemo(() => {
    if (!viewerIp) return [];
    return historyRuns.filter(
      (r) => r.state === "running" && (r.requestIp ?? "").trim() === viewerIp,
    );
  }, [historyRuns, viewerIp]);

  const remotePendingInstruction = String(remotePending?.instruction ?? "").trim();

  const hasMyIpServerActivity =
    Boolean(remotePendingInstruction) ||
    myQueueJobs.length > 0 ||
    myIpRunningHistory.length > 0;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      pendingAfterRef.current = [];
    };
  }, []);

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
    runStreamImpl.current = async (ins: string, opts?: { chained?: boolean }) => {
      if (!available) return;
      const trimmed = ins.trim();
      if (!trimmed) return;

      if (!opts?.chained) {
        if (streamSessionLockRef.current) return;
        streamSessionLockRef.current = true;
      }

      runIdRef.current = null;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setSubmitting(true);
      setPhaseLine("서버에 연결하는 중…");
      setStreamHeadlineInstruction(trimmed);
      setError(null);
      setResultText(null);
      setStatusText(null);
      setDurationMs(null);
      setRuntimeLabel(null);
      setPhaseLine("");
      setCursorLine("");
      setThinkingLine("");
      setToolLine("");
      setStreamText("");

      let didAbort = false;

      try {
        await fetchOpsCursorAgentStream(
          trimmed,
          (ev) => {
            if (ev.type === "meta") {
              const rid = typeof ev.requestId === "string" ? ev.requestId.trim() : "";
              if (rid) runIdRef.current = rid;
              return;
            }
            if (ev.type === "phase") {
              setPhaseLine(ev.message);
            } else if (ev.type === "delta") {
              setStreamText((prev) => prev + ev.text);
            } else if (ev.type === "cursor_status") {
              const d = ev.detail?.trim();
              const line = d ? `${ev.status}: ${d}` : ev.status;
              setCursorLine(line);
            } else if (ev.type === "thinking") {
              setThinkingLine(ev.text);
            } else if (ev.type === "tool") {
              setToolLine(`${ev.name} (${ev.toolStatus})`);
            } else if (ev.type === "done") {
              setStatusText(ev.status);
              const res = ev.result?.trim() ? ev.result : "(내용 없음)";
              setResultText(res);
              const dur =
                typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs)
                  ? ev.durationMs
                  : null;
              setDurationMs(dur);
              setRuntimeLabel(ev.runtime ?? null);
            } else if (ev.type === "error") {
              setError(ev.message);
            }
          },
          ac.signal,
        );
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          didAbort = true;
          setError(ko.app.opsCancelled);
        } else {
          setError(e instanceof Error ? e.message : ko.app.opsError);
        }
      } finally {
        setSubmitting(false);
        setStreamHeadlineInstruction("");
        if (abortRef.current === ac) abortRef.current = null;

        if (!didAbort && !ac.signal.aborted) {
          void fetchOpsAgentHistory()
            .then((r) => setHistoryRuns(Array.isArray(r.entries) ? r.entries : []))
            .catch(() => {
              /* 폴링으로 보완 */
            });
        }

        void fetchOpsCursorAgentQueue()
          .then((r) => setServerQueue(Array.isArray(r.entries) ? r.entries : []))
          .catch(() => {
            /* 큐 폴링으로 보완 */
          });

        const nextIns = pendingAfterRef.current.shift();
        setQueuedCount(pendingAfterRef.current.length);
        if (nextIns) {
          void runStreamImpl.current(nextIns, { chained: true });
        } else {
          streamSessionLockRef.current = false;
        }
      }
    };
  }, [available]);

  const runOneStream = useCallback((ins: string) => {
    void runStreamImpl.current(ins);
  }, []);

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

  const handleMainSubmit = useCallback(() => {
    if (!available || submitting || streamSessionLockRef.current) return;
    const ins = instruction.trim();
    if (!ins) return;
    runOneStream(ins);
  }, [available, submitting, instruction, runOneStream]);

  const handleNextSubmit = useCallback(() => {
    if (!available) return;
    const n = nextInstruction.trim();
    if (!n) return;
    if (submitting || streamSessionLockRef.current) {
      pendingAfterRef.current.push(n);
      setQueuedCount(pendingAfterRef.current.length);
      setNextInstruction("");
      return;
    }
    runOneStream(n);
  }, [available, submitting, nextInstruction, runOneStream]);

  const handleCancelRequest = useCallback(async () => {
    const rid = runIdRef.current;
    if (rid) {
      try {
        await postOpsCursorAgentStreamCancel(rid);
      } catch {
        /* 서버 취소 실패해도 로컬 읽기는 중단 */
      }
    }
    abortRef.current?.abort();
  }, []);

  const showStream =
    submitting ||
    Boolean(phaseLine || cursorLine || thinkingLine || toolLine || streamText);

  /** IP 연결 상태 말풍선: 진행 중/대기/큐에 실제 작업이 있을 때만 노출 — 유효하지 않게 전체 화면을 덮지 않음 */
  const showMyIpJobsPanel =
    hasMyIpServerActivity || submitting || queuedCount > 0;

  return (
    <div className="ops-management ops-management--split">
      <div className="ops-management__main">
        {available ? (
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
                {serverQueue.length === 0 ? (
                  <span className="ops-management__server-queue-empty">{ko.app.opsAgentQueueEmpty}</span>
                ) : (
                  serverQueue.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      className={`ops-agent-queue-card ops-agent-queue-card--${q.status}`}
                      aria-label={ko.app.opsQueueProgressModalTitle + ": " + (q.instructionPreview.trim() || "—")}
                      onClick={() => setProgressModalRunId(q.id)}
                    >
                      <div className="ops-agent-queue-card__top">
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
                  {showStream ? (
                    <div
                      className="ops-management__stream ops-management__stream--bubble-duplicate card"
                      aria-hidden="true"
                    >
                      <OpsManagementLiveStreamContent
                        streamHeadlineInstruction={streamHeadlineInstruction}
                        phaseLine={phaseLine}
                        cursorLine={cursorLine}
                        toolLine={toolLine}
                        thinkingLine={thinkingLine}
                        streamText={streamText}
                      />
                    </div>
                  ) : null}
                  {viewerIp && !hasMyIpServerActivity && queuedCount === 0 ? (
                    <p className="ops-management__my-ip-none" role="status">
                      {ko.app.opsMyIpJobsNone}
                    </p>
                  ) : null}

                  {remotePendingInstruction ? (
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

                  {myIpRunningHistory.length > 0 ? (
                    <div className="ops-management__my-ip-running-block">
                      <p className="ops-management__my-ip-subtitle">{ko.app.opsMyIpHistoryRunning}</p>
                      <div
                        className="ops-agent-queue-track"
                        role="group"
                        aria-label={ko.app.opsMyIpHistoryRunning}
                      >
                        {myIpRunningHistory.map((run) => {
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

        <div className="panel-head ops-management__head">
          <h3 className="ops-management__title">{ko.app.opsPanelTitle}</h3>
        </div>

        {!available ? (
          <div className="alert alert--error ops-management__banner" role="status">
            {ko.app.opsNoKey}
          </div>
        ) : null}

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
            disabled={!available || submitting}
            spellCheck={false}
          />

          <div className="ops-management__actions">
            <button
              type="button"
              className="btn btn--primary ops-management__submit"
              disabled={!available || submitting || !instruction.trim()}
              onClick={() => void handleMainSubmit()}
            >
              {submitting ? ko.app.opsSubmitting : ko.app.opsSubmit}
            </button>
            <button
              type="button"
              className="btn btn--secondary ops-management__cancel"
              disabled={!available || !submitting}
              onClick={() => void handleCancelRequest()}
            >
              {ko.app.opsCancelRequest}
            </button>
          </div>
        </div>

        {showStream ? (
          <div className="ops-management__stream card" aria-live="polite">
            <OpsManagementLiveStreamContent
              streamHeadlineInstruction={streamHeadlineInstruction}
              phaseLine={phaseLine}
              cursorLine={cursorLine}
              toolLine={toolLine}
              thinkingLine={thinkingLine}
              streamText={streamText}
            />
          </div>
        ) : null}

        {error ? (
          <div className="alert alert--error ops-management__out" role="alert">
            {error}
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

        {available && (submitting || queuedCount > 0) ? (
          <div className="ops-management__next-block">
            <label className="ops-management__label" htmlFor="ops-next-instruction">
              {ko.app.opsNextInstructionLabel}
            </label>
            <textarea
              id="ops-next-instruction"
              className="ops-management__textarea ops-management__textarea--sm"
              value={nextInstruction}
              onChange={(e) => setNextInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.repeat) return;
                if (!(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                void handleNextSubmit();
              }}
              placeholder={ko.app.opsNextInstructionPlaceholder}
              rows={4}
              spellCheck={false}
            />
            {queuedCount > 0 ? (
              <p className="ops-management__queue-hint">
                {ko.app.opsQueuePending.replace("{n}", String(queuedCount))}
              </p>
            ) : null}
            <div className="ops-management__actions">
              <button
                type="button"
                className="btn btn--primary ops-management__submit"
                disabled={!nextInstruction.trim()}
                onClick={() => void handleNextSubmit()}
              >
                {submitting ? ko.app.opsNextSubmitQueued : ko.app.opsNextSubmitNow}
              </button>
            </div>
          </div>
        ) : null}
      </div>

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
                  run.streamText,
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
                      </div>
                    ) : null}

                    {run.error ? (
                      <div className="alert alert--error ops-management__history-error" role="alert">
                        {run.error}
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
      {progressModalRunId ? (
        <OpsAgentQueueProgressModal
          runId={progressModalRunId}
          queueEntries={serverQueue}
          historyRuns={historyRuns}
          onClose={() => setProgressModalRunId(null)}
        />
      ) : null}
    </div>
  );
}
