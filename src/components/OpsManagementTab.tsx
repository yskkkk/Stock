import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteOpsAgentHistory,
  deleteOpsAgentHistoryEntry,
  fetchOpsAgentHistory,
  fetchOpsCursorAgentStream,
  postOpsCursorAgentStreamCancel,
  type OpsAgentHistoryEntry,
} from "../api";
import { ko } from "../i18n/ko";

const HISTORY_POLL_MS = 2000;

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
  if (s === "running") return ko.app.opsHistoryStatusRunning;
  if (s === "error") return ko.app.opsHistoryStatusError;
  if (s === "cancelled") return ko.app.opsHistoryStatusCancelled;
  return ko.app.opsHistoryStatusOk;
}

export default function OpsManagementTab({
  available,
}: {
  available: boolean;
}) {
  const [instruction, setInstruction] = useState("");
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

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const pendingAfterRef = useRef<string[]>([]);
  const runStreamImpl = useRef<(ins: string) => Promise<void>>(async () => {});

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      pendingAfterRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!available) {
      setHistoryRuns([]);
      return;
    }
    let cancelled = false;
    const pull = () => {
      void fetchOpsAgentHistory()
        .then((r) => {
          if (!cancelled) setHistoryRuns(Array.isArray(r.entries) ? r.entries : []);
        })
        .catch(() => {
          /* 다음 폴링에서 재시도 */
        });
    };
    pull();
    const id = window.setInterval(pull, HISTORY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [available]);

  useEffect(() => {
    runStreamImpl.current = async (ins: string) => {
      if (!available) return;
      const trimmed = ins.trim();
      if (!trimmed) return;

      runIdRef.current = null;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setSubmitting(true);
      setPhaseLine("서버에 연결하는 중…");
      setInstruction(trimmed);
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
          "",
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
        if (abortRef.current === ac) abortRef.current = null;

        if (!didAbort && !ac.signal.aborted) {
          void fetchOpsAgentHistory()
            .then((r) => setHistoryRuns(Array.isArray(r.entries) ? r.entries : []))
            .catch(() => {
              /* 폴링으로 보완 */
            });
        }

        const nextIns = pendingAfterRef.current.shift();
        setQueuedCount(pendingAfterRef.current.length);
        if (nextIns) {
          void runStreamImpl.current(nextIns);
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

  const deleteHistoryEntry = useCallback(async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(ko.app.opsHistoryDeleteEntryConfirm)
    ) {
      return;
    }
    try {
      await deleteOpsAgentHistoryEntry(id);
      setHistoryRuns((prev) => prev.filter((r) => r.id !== id));
    } catch {
      void fetchOpsAgentHistory()
        .then((r) => setHistoryRuns(Array.isArray(r.entries) ? r.entries : []))
        .catch(() => {
          /* 폴링으로 보완 */
        });
    }
  }, []);

  const handleMainSubmit = useCallback(() => {
    if (!available || submitting) return;
    const ins = instruction.trim();
    if (!ins) return;
    runOneStream(ins);
  }, [available, submitting, instruction, runOneStream]);

  const handleNextSubmit = useCallback(() => {
    if (!available) return;
    const n = nextInstruction.trim();
    if (!n) return;
    if (submitting) {
      pendingAfterRef.current.push(n);
      setQueuedCount(pendingAfterRef.current.length);
      setNextInstruction("");
      return;
    }
    setNextInstruction("");
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

  return (
    <div className="ops-management ops-management--split">
      <div className="ops-management__main">
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
            <p className="ops-management__stream-title">{ko.app.opsStreamTitle}</p>
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
                state === "running"
                  ? (run.updatedAtMs ?? run.startedAtMs ?? Date.now())
                  : (run.finishedAtMs ?? run.updatedAtMs ?? run.startedAtMs ?? Date.now());
              const badgeClass =
                state === "running"
                  ? "ops-history__badge--pending"
                  : state === "ok"
                    ? "ops-history__badge--ok"
                    : "ops-history__badge--err";

              const canDeleteEntry = state !== "running";

              return (
                <li key={run.id} className="ops-management__history-item">
                  <details className="ops-management__history-details">
                    <summary className="ops-management__history-summary">
                      <span className={`ops-history__badge ${badgeClass}`}>
                        {historyStateLabel(state)}
                      </span>
                      <span className="ops-management__history-when">{formatHistoryTs(tsMs)}</span>
                      <span className="ops-management__history-snippet">{header}</span>
                      {canDeleteEntry ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm ops-management__history-delete"
                          aria-label={ko.app.opsHistoryDeleteEntryAria}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void deleteHistoryEntry(run.id);
                          }}
                        >
                          {ko.app.opsHistoryDeleteEntry}
                        </button>
                      ) : null}
                    </summary>

                    <p className="ops-management__history-instruction-label">
                      {ko.app.opsHistoryInstructionReplay}
                    </p>
                    <pre className="ops-management__history-instruction">{run.instruction}</pre>
                    {run.requestIp ? (
                      <p className="ops-management__history-ip">
                        <span className="ops-management__history-ip-k">
                          {ko.app.opsHistoryRequestIp}
                        </span>
                        <span className="ops-management__history-ip-v ops-management__stream-v--mono">
                          {run.requestIp}
                        </span>
                      </p>
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
                      </div>
                    ) : null}

                    {run.error ? (
                      <div className="alert alert--error ops-management__history-error" role="alert">
                        {run.error}
                      </div>
                    ) : null}
                    {run.resultText != null && state !== "running" ? (
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
    </div>
  );
}
