import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteOpsAgentHistory,
  fetchOpsAgentHistory,
  fetchOpsCursorAgentPending,
  fetchOpsCursorAgentStream,
  type OpsAgentHistoryEntry,
} from "../api";
import { ko } from "../i18n/ko";

const HISTORY_POLL_MS = 2000;

function formatHistorySavedAt(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export default function OpsManagementTab({
  available,
}: {
  available: boolean;
}) {
  const [opsUiTab, setOpsUiTab] = useState<"request" | "history">("request");
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
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
    if (!available || opsUiTab !== "request") return;
    let cancelled = false;
    void fetchOpsCursorAgentPending()
      .then((r) => {
        if (cancelled) return;
        const ins = (r.instruction ?? "").trim();
        if (!ins) return;
        setInstruction((prev) => (prev.trim() === "" ? r.instruction : prev));
      })
      .catch(() => {
        /* 다음 진입·탭 전환에서 재시도 */
      });
    return () => {
      cancelled = true;
    };
  }, [available, opsUiTab]);

  const clearHistory = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm(ko.app.opsHistoryClearConfirm)) {
      return;
    }
    try {
      await deleteOpsAgentHistory();
      setHistoryRuns([]);
    } catch {
      /* 요청 실패 시 목록 유지 — 다음 폴링으로 동기화 */
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!available || submitting) return;
    const ins = instruction.trim();
    if (!ins) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setSubmitting(true);
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
        ins,
        "",
        (ev) => {
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
            const line = `${ev.name} (${ev.toolStatus})`;
            setToolLine(line);
          } else if (ev.type === "done") {
            setStatusText(ev.status);
            const res = ev.result?.trim() ? ev.result : "(내용 없음)";
            setResultText(res);
            const dur =
              typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs)
                ? ev.durationMs
                : null;
            setDurationMs(dur);
            const rt = ev.runtime ?? null;
            setRuntimeLabel(rt);
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        },
        ac.signal,
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        didAbort = true;
      } else {
        const msg = e instanceof Error ? e.message : ko.app.opsError;
        setError(msg);
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
    }
  }, [available, submitting, instruction]);

  const showStream =
    submitting ||
    Boolean(phaseLine || cursorLine || thinkingLine || toolLine || streamText);

  return (
    <div className="ops-management">
      <div className="panel-head ops-management__head">
        <h3 className="ops-management__title">{ko.app.opsPanelTitle}</h3>
        <div className="market-tabs ops-management__subtabs" role="tablist" aria-label={ko.app.opsPanelTitle}>
          <button
            type="button"
            role="tab"
            aria-selected={opsUiTab === "request"}
            className={opsUiTab === "request" ? "market-tab active" : "market-tab"}
            onClick={() => setOpsUiTab("request")}
          >
            {ko.app.opsTabRequest}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={opsUiTab === "history"}
            className={opsUiTab === "history" ? "market-tab active" : "market-tab"}
            onClick={() => setOpsUiTab("history")}
          >
            {ko.app.opsTabHistory}
          </button>
        </div>
      </div>

      {opsUiTab === "request" ? (
        <>
          <p className="panel-hint ops-management__hint">{ko.app.opsPanelHint}</p>

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
              rows={14}
              disabled={!available || submitting}
              spellCheck={false}
            />

            <button
              type="button"
              className="btn btn--primary ops-management__submit"
              disabled={!available || submitting || !instruction.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? ko.app.opsSubmitting : ko.app.opsSubmit}
            </button>
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
                      <span className="ops-management__meta-k">
                        {ko.app.opsDurationLabel}
                      </span>
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
      ) : (
        <section
          className="ops-management__history-pane card"
          aria-labelledby="ops-history-heading"
        >
          <div className="ops-management__history-bar">
            <h4 id="ops-history-heading" className="ops-management__history-title">
              {ko.app.opsHistoryTitle}
            </h4>
            {historyRuns.length > 0 ? (
              <button
                type="button"
                className="btn btn--ghost ops-management__history-clear"
                onClick={() => void clearHistory()}
              >
                {ko.app.opsHistoryClearAll}
              </button>
            ) : null}
          </div>
          <p className="panel-hint ops-management__history-hint">{ko.app.opsHistoryHint}</p>
          {historyRuns.length === 0 ? (
            <p className="ops-management__history-empty">{ko.app.opsHistoryEmpty}</p>
          ) : (
            <ul className="ops-management__history-list">
              {historyRuns.map((run) => {
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

                return (
                  <li key={run.id} className="ops-management__history-item">
                    <details className="ops-management__history-details">
                      <summary className="ops-management__history-summary">
                        <span className="ops-management__history-when">
                          {formatHistorySavedAt(run.finishedAtMs)}
                        </span>
                        {run.clientIp ? (
                          <span className="ops-management__history-ip-line">
                            {ko.app.opsHistoryClientIp}: {run.clientIp}
                          </span>
                        ) : null}
                        <span className="ops-management__history-snippet">{header}</span>
                      </summary>

                      <p className="ops-management__history-instruction-label">
                        {ko.app.opsHistoryInstructionReplay}
                      </p>
                      <pre className="ops-management__history-instruction">{run.instruction}</pre>

                      {showArchiveStream ? (
                        <div className="ops-management__stream ops-management__stream--archive card">
                          <p className="ops-management__stream-title">
                            {ko.app.opsHistoryStreamArchived}
                          </p>
                          {run.phaseLine ? (
                            <p className="ops-management__stream-row">
                              <span className="ops-management__stream-k">
                                {ko.app.opsStreamPhase}
                              </span>
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
                      ) : run.resultText != null ? (
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
        </section>
      )}
    </div>
  );
}
