import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  clearStockOpsInstructionDraft,
  fetchOpsCursorAgentPending,
  fetchOpsCursorAgentStream,
  type OpsAgentQueueEntry,
  type OpsCursorAgentPendingResponse,
} from "../api";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { useIsMobilePhone } from "../hooks/useIsMobilePhone";
import { useOpsDevQueueDisplay } from "../hooks/useOpsDevQueueDisplay";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import { parseOpsDevQueueAgentEntries } from "../lib/opsGlobalQueueRows";
import { ko } from "../i18n/ko";

const PENDING_POLL_MS = 2000;

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

function opsQueueSourceLabel(
  source: OpsAgentQueueEntry["source"] | undefined,
  requestIp: string,
): string {
  if (requestIp.trim() === "claude-code") return ko.app.opsGlobalQueueSourceClaudeCode;
  if (source === "ide") return ko.app.opsGlobalQueueSourceIde;
  if (source === "web") return ko.app.opsGlobalQueueSourceWeb;
  if (requestIp.trim() === "cursor-ide") return ko.app.opsGlobalQueueSourceIde;
  return ko.app.opsGlobalQueueSourceWeb;
}

function OpsQueueUnifiedSeqBadge({ seq }: { seq?: number | null }) {
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq < 1) return null;
  return (
    <span className="ops-agent-queue-card__seq" title={ko.app.opsUnifiedQueueSeqTitle}>
      #{seq}
    </span>
  );
}

export type OpsInstructionEditorHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  clear: () => void;
};

/** 요청 입력·제출 — 상위 OpsManagementTab(큐)과 분리해 타이핑 시 전체 리렌더 방지 */
const OpsInstructionEditor = memo(
  forwardRef<
    OpsInstructionEditorHandle,
    {
      available: boolean;
      submitting: boolean;
      error: string | null;
      onClearError: () => void;
      onSubmit: (instruction: string) => void | Promise<void>;
      onRetryFromError: (instruction: string) => void;
      onEditingChange?: (editing: boolean) => void;
    }
  >(function OpsInstructionEditor(
    {
      available,
      submitting,
      error,
      onClearError,
      onSubmit,
      onRetryFromError,
      onEditingChange,
    },
    ref,
  ) {
    const mobile = useIsMobilePhone();
    const [instruction, setInstruction] = useState("");
    const instructionRef = useRef(instruction);
    instructionRef.current = instruction;

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => instructionRef.current,
        setValue: (value: string) => setInstruction(value),
        clear: () => setInstruction(""),
      }),
      [],
    );

    const handleSubmit = useCallback(() => {
      if (!available || submitting) return;
      const ins = instructionRef.current.trim();
      if (!ins) return;
      setInstruction("");
      void onSubmit(ins);
    }, [available, submitting, onSubmit]);

    return (
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
            onFocus={() => onEditingChange?.(true)}
            onBlur={() => onEditingChange?.(false)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.repeat) return;
              if (!(e.ctrlKey || e.metaKey)) return;
              e.preventDefault();
              handleSubmit();
            }}
            placeholder={ko.app.opsInstructionPlaceholder}
            rows={mobile ? 5 : 10}
            disabled={!available}
            spellCheck={false}
          />

        <div className="ops-management__actions">
          <button
            type="button"
            className="btn btn--primary ops-management__submit"
            disabled={!available || submitting || !instruction.trim()}
            onClick={handleSubmit}
          >
            {ko.app.opsSubmit}
          </button>
        </div>
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
                onClearError();
                onRetryFromError(instruction);
              }}
            >
              {ko.app.opsHistoryRetryFromError}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
  }),
);

function OpsAgentQueueProgressModal({
  runId,
  queueEntries,
  onClose,
}: {
  runId: string;
  queueEntries: OpsAgentQueueEntry[];
  onClose: () => void;
}) {
  const queueRow = useMemo(
    () => queueEntries.find((q) => q.id === runId) ?? null,
    [queueEntries, runId],
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
    queueRow?.instructionBody?.trim().length
      ? queueRow.instructionBody
      : queueRow?.instructionTooltip?.trim().length
        ? queueRow.instructionTooltip
        : queueRow?.instructionPreview ?? "";

  const statusLabel =
    queueRow?.status === "waiting"
      ? ko.app.opsAgentQueueWaiting
      : queueRow?.status === "running"
        ? ko.app.opsHistoryStatusRunning
        : ko.app.opsHistoryStatusOk;

  const tsMs = queueRow?.enqueuedAtMs ?? Date.now();

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
          {queueRow == null ? (
            <p className="ops-queue-progress-stale" role="status">
              {ko.app.opsQueueProgressStale}
            </p>
          ) : null}

          {queueRow?.status === "waiting" ? (
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
  const instructionEditorRef = useRef<OpsInstructionEditorHandle>(null);
  const editorEditingRef = useRef(false);
  const refreshAfterEditRef = useRef<(() => void) | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState<string | null>(null);

  const [serverQueue, setServerQueue] = useState<OpsAgentQueueEntry[]>([]);
  const [viewerIp, setViewerIp] = useState<string | null>(null);
  const [remotePending, setRemotePending] = useState<OpsCursorAgentPendingResponse | null>(
    null,
  );
  const [progressModalRunId, setProgressModalRunId] = useState<string | null>(null);

  useMobileBackHandler(
    Boolean(progressModalRunId),
    MOBILE_BACK_PRIORITY.OPS_PROGRESS,
    () => setProgressModalRunId(null),
  );

  const queueSnap = useOpsDevQueueDisplay({
    includeViewerIp: true,
    enabled: available,
  });

  useEffect(() => {
    if (!queueSnap || editorEditingRef.current) return;
    const entries = parseOpsDevQueueAgentEntries(queueSnap.agentEntries);
    setServerQueue((prev) => {
      const prevKey = prev
        .map(
          (q) =>
            `${q.id}:${q.status}:${q.unifiedQueueSeq ?? ""}:${q.instructionPreview}:${q.requestIp}`,
        )
        .join("|");
      const nextKey = entries
        .map(
          (q) =>
            `${q.id}:${q.status}:${q.unifiedQueueSeq ?? ""}:${q.instructionPreview}:${q.requestIp}`,
        )
        .join("|");
      return prevKey === nextKey ? prev : entries;
    });
    const rawIp = queueSnap.viewerIp;
    const ip =
      rawIp === null || rawIp === undefined ? null : String(rawIp).trim() || null;
    setViewerIp((prev) => (prev === ip ? prev : ip));
  }, [queueSnap]);

  const activeServerQueue = serverQueue;

  const myQueueJobs = useMemo(() => {
    const ip = viewerIp?.trim() || null;
    return ip ? activeServerQueue.filter((q) => q.requestIp === ip) : [];
  }, [activeServerQueue, viewerIp]);

  const remotePendingInstruction = String(remotePending?.instruction ?? "").trim();

  /** pending API는 SSE용 복구 안내지만, 실행 큐에 이미 같은 IP의 실행 중 행이 있으면 카드 하나로 충분 */
  const showRemotePendingDupBlock =
    Boolean(remotePendingInstruction) && !myQueueJobs.some((q) => q.status === "running");

  const hasMyIpServerActivity =
    Boolean(remotePendingInstruction) || myQueueJobs.length > 0;

  /** 예전 초안 저장 키를 비워 둠 (새로고침·재방문 후에도 텍스트는 복원하지 않음) */
  useEffect(() => {
    if (available) clearStockOpsInstructionDraft();
  }, [available]);

  useEffect(() => {
    if (!available) {
      setServerQueue([]);
      setViewerIp(null);
      setRemotePending(null);
      return;
    }
    let cancelled = false;

    const pullPending = () => {
      if (editorEditingRef.current) return;
      void fetchOpsCursorAgentPending()
        .then((p) => {
          if (cancelled || editorEditingRef.current) return;
          setRemotePending((prev) => {
            const prevKey = `${prev?.instruction ?? ""}:${prev?.startedAtMs ?? ""}`;
            const nextKey = `${p.instruction ?? ""}:${p.startedAtMs ?? ""}`;
            return prevKey === nextKey ? prev : p;
          });
        })
        .catch(() => {
          /* 접근 게이트 복귀 직후 등 — 조용히 무시 */
        });
    };

    refreshAfterEditRef.current = pullPending;

    pullPending();

    const pendId = window.setInterval(pullPending, PENDING_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") pullPending();
    };
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) pullPending();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      refreshAfterEditRef.current = null;
      window.clearInterval(pendId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [available]);

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

  const handleEditorSubmit = useCallback(
    async (ins: string) => {
      const ok = await enqueueOrRunInstruction(ins);
      if (!ok) instructionEditorRef.current?.setValue(ins);
    },
    [enqueueOrRunInstruction],
  );

  const clearEditorError = useCallback(() => setError(null), []);

  const handleEditorEditingChange = useCallback((editing: boolean) => {
    editorEditingRef.current = editing;
    if (!editing) refreshAfterEditRef.current?.();
  }, []);

  const showMyIpJobsPanel = hasMyIpServerActivity || submitting;

  return (
    <div className="ops-management">
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
                {activeServerQueue.length === 0 ? (
                  <span className="ops-management__server-queue-empty">{ko.app.opsAgentQueueEmpty}</span>
                ) : (
                  activeServerQueue.map((q) => (
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
                          className="ops-agent-queue-card__source"
                          title={ko.app.opsGlobalQueueFieldSource}
                        >
                          {opsQueueSourceLabel(q.source, q.requestIp)}
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

        <div className="panel-head ops-management__head">
          <h3 className="ops-management__title">{ko.app.opsPanelTitle}</h3>
        </div>

        {!available ? (
          <div className="alert alert--error ops-management__banner" role="status">
            {ko.app.opsNoKey}
          </div>
        ) : null}

        <OpsInstructionEditor
          ref={instructionEditorRef}
          available={available}
          submitting={submitting}
          error={error}
          onClearError={clearEditorError}
          onSubmit={handleEditorSubmit}
          onRetryFromError={enqueueAgentInstructionOnServerOnly}
          onEditingChange={handleEditorEditingChange}
        />

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

      </div>

      {progressModalRunId ? (
        <OpsAgentQueueProgressModal
          runId={progressModalRunId}
          queueEntries={activeServerQueue}
          onClose={() => setProgressModalRunId(null)}
        />
      ) : null}
    </div>
  );
}


