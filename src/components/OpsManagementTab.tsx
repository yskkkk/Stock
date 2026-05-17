import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOpsCursorAgentStream } from "../api";
import { ko } from "../i18n/ko";

type OpsAgentHistoryEntry = {
  id: string;
  finishedAtMs: number;
  instruction: string;
  error: string | null;
  phaseLine: string;
  cursorLine: string;
  thinkingLine: string;
  toolLine: string;
  streamText: string;
  statusText: string | null;
  resultText: string | null;
  durationMs: number | null;
  runtimeLabel: string | null;
};

const OPS_AGENT_HISTORY_LS_KEY = "stock-dash.ops-cursor-agent-history.v1";
const OPS_AGENT_HISTORY_MAX = 40;
const OPS_AGENT_FIELD_MAX_CHARS = 120_000;
const OPS_AGENT_INSTRUCTION_STORE_MAX = 16_000;

function trimStoredText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n…(${ko.app.opsStoredTruncated})`;
}

function isPlainHistoryObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

function parseHistoryRecord(o: Record<string, unknown>): OpsAgentHistoryEntry | null {
  if (
    typeof o.id !== "string" ||
    typeof o.instruction !== "string" ||
    typeof o.finishedAtMs !== "number" ||
    !Number.isFinite(o.finishedAtMs)
  ) {
    return null;
  }

  const errRaw = o.error;
  const error =
    typeof errRaw === "string" && errRaw.trim().length > 0 ? errRaw.trim() : null;

  return {
    id: o.id,
    finishedAtMs: o.finishedAtMs,
    instruction: o.instruction,
    error,
    phaseLine: typeof o.phaseLine === "string" ? o.phaseLine : "",
    cursorLine: typeof o.cursorLine === "string" ? o.cursorLine : "",
    thinkingLine: typeof o.thinkingLine === "string" ? o.thinkingLine : "",
    toolLine: typeof o.toolLine === "string" ? o.toolLine : "",
    streamText: typeof o.streamText === "string" ? o.streamText : "",
    statusText: typeof o.statusText === "string" ? o.statusText : null,
    resultText: typeof o.resultText === "string" ? o.resultText : null,
    durationMs:
      typeof o.durationMs === "number" && Number.isFinite(o.durationMs)
        ? o.durationMs
        : null,
    runtimeLabel: typeof o.runtimeLabel === "string" ? o.runtimeLabel : null,
  };
}

function loadHistory(): OpsAgentHistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(OPS_AGENT_HISTORY_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isPlainHistoryObject)
      .map(parseHistoryRecord)
      .filter((e): e is OpsAgentHistoryEntry => e !== null)
      .slice(0, OPS_AGENT_HISTORY_MAX);
  } catch {
    return [];
  }
}

function persistHistory(entries: OpsAgentHistoryEntry[]): void {
  try {
    localStorage.setItem(OPS_AGENT_HISTORY_LS_KEY, JSON.stringify(entries));
  } catch {
    /* quota / private mode */
  }
}

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

  const [historyRuns, setHistoryRuns] = useState<OpsAgentHistoryEntry[]>(loadHistory);

  const abortRef = useRef<AbortController | null>(null);
  const runCaptureRef = useRef<Pick<
    OpsAgentHistoryEntry,
    | "phaseLine"
    | "cursorLine"
    | "thinkingLine"
    | "toolLine"
    | "streamText"
    | "statusText"
    | "resultText"
    | "durationMs"
    | "runtimeLabel"
    | "error"
  >>({
    phaseLine: "",
    cursorLine: "",
    thinkingLine: "",
    toolLine: "",
    streamText: "",
    statusText: null,
    resultText: null,
    durationMs: null,
    runtimeLabel: null,
    error: null,
  });

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const clearHistory = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm(ko.app.opsHistoryClearConfirm)) {
      return;
    }
    setHistoryRuns([]);
    try {
      localStorage.removeItem(OPS_AGENT_HISTORY_LS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const persistCompletedRun = useCallback((instructionSnapshot: string) => {
    const cap = runCaptureRef.current;
    const entry: OpsAgentHistoryEntry = {
      id:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      finishedAtMs: Date.now(),
      instruction: trimStoredText(instructionSnapshot, OPS_AGENT_INSTRUCTION_STORE_MAX),
      error: cap.error?.trim() ? cap.error.trim() : null,
      phaseLine: cap.phaseLine,
      cursorLine: cap.cursorLine,
      thinkingLine: cap.thinkingLine,
      toolLine: cap.toolLine,
      streamText: trimStoredText(cap.streamText, OPS_AGENT_FIELD_MAX_CHARS),
      statusText: cap.statusText,
      resultText:
        cap.resultText != null
          ? trimStoredText(cap.resultText, OPS_AGENT_FIELD_MAX_CHARS)
          : null,
      durationMs: cap.durationMs,
      runtimeLabel: cap.runtimeLabel,
    };

    setHistoryRuns((prev) => {
      const next = [entry, ...prev].slice(0, OPS_AGENT_HISTORY_MAX);
      persistHistory(next);
      return next;
    });
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

    runCaptureRef.current = {
      phaseLine: "",
      cursorLine: "",
      thinkingLine: "",
      toolLine: "",
      streamText: "",
      statusText: null,
      resultText: null,
      durationMs: null,
      runtimeLabel: null,
      error: null,
    };

    let didAbort = false;

    try {
      await fetchOpsCursorAgentStream(
        ins,
        "",
        (ev) => {
          if (ev.type === "phase") {
            setPhaseLine(ev.message);
            runCaptureRef.current.phaseLine = ev.message;
          } else if (ev.type === "delta") {
            setStreamText((prev) => {
              const merged = prev + ev.text;
              runCaptureRef.current.streamText = merged;
              return merged;
            });
          } else if (ev.type === "cursor_status") {
            const d = ev.detail?.trim();
            const line = d ? `${ev.status}: ${d}` : ev.status;
            setCursorLine(line);
            runCaptureRef.current.cursorLine = line;
          } else if (ev.type === "thinking") {
            setThinkingLine(ev.text);
            runCaptureRef.current.thinkingLine = ev.text;
          } else if (ev.type === "tool") {
            const line = `${ev.name} (${ev.toolStatus})`;
            setToolLine(line);
            runCaptureRef.current.toolLine = line;
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
            runCaptureRef.current.statusText = ev.status;
            runCaptureRef.current.resultText = res;
            runCaptureRef.current.durationMs = dur;
            runCaptureRef.current.runtimeLabel = rt;
          } else if (ev.type === "error") {
            setError(ev.message);
            runCaptureRef.current.error = ev.message;
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
        runCaptureRef.current.error = msg;
      }
    } finally {
      setSubmitting(false);
      if (abortRef.current === ac) abortRef.current = null;

      const save =
        !didAbort &&
        !ac.signal.aborted &&
        (runCaptureRef.current.error != null ||
          runCaptureRef.current.resultText != null ||
          runCaptureRef.current.streamText.trim().length > 0 ||
          runCaptureRef.current.phaseLine.trim().length > 0 ||
          runCaptureRef.current.cursorLine.trim().length > 0);

      if (save) persistCompletedRun(ins);
    }
  }, [available, submitting, instruction, persistCompletedRun]);

  const showStream =
    submitting ||
    Boolean(phaseLine || cursorLine || thinkingLine || toolLine || streamText);

  return (
    <div className="ops-management">
      <div className="panel-head">
        <h3 className="ops-management__title">{ko.app.opsPanelTitle}</h3>
      </div>
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
          className="ops-management__textarea"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={ko.app.opsInstructionPlaceholder}
          rows={6}
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

      <section
        className="ops-management__history card"
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
              onClick={clearHistory}
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
              const summaryLine = run.instruction.split(/\r?\n/).find(Boolean) ?? run.instruction;
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
    </div>
  );
}
