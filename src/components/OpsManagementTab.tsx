import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOpsCursorAgentStream } from "../api";
import { ko } from "../i18n/ko";

export default function OpsManagementTab({
  available,
}: {
  available: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const [context, setContext] = useState("");
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

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
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

    try {
      await fetchOpsCursorAgentStream(
        ins,
        context.trim(),
        (ev) => {
          if (ev.type === "phase") {
            setPhaseLine(ev.message);
          } else if (ev.type === "delta") {
            setStreamText((prev) => prev + ev.text);
          } else if (ev.type === "cursor_status") {
            const d = ev.detail?.trim();
            setCursorLine(
              d ? `${ev.status}: ${d}` : ev.status,
            );
          } else if (ev.type === "thinking") {
            setThinkingLine(ev.text);
          } else if (ev.type === "tool") {
            setToolLine(`${ev.name} (${ev.toolStatus})`);
          } else if (ev.type === "done") {
            setStatusText(ev.status);
            setResultText(ev.result?.trim() ? ev.result : "(내용 없음)");
            setDurationMs(
              typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs)
                ? ev.durationMs
                : null,
            );
            setRuntimeLabel(ev.runtime ?? null);
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        },
        ac.signal,
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : ko.app.opsError);
    } finally {
      setSubmitting(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [available, submitting, instruction, context]);

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

        <label className="ops-management__label" htmlFor="ops-context">
          {ko.app.opsContextLabel}
        </label>
        <textarea
          id="ops-context"
          className="ops-management__textarea ops-management__textarea--sm"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={ko.app.opsContextPlaceholder}
          rows={3}
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
    </div>
  );
}
