import { useCallback, useState } from "react";
import { postOpsCursorAgent } from "../api";
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

  const handleSubmit = useCallback(async () => {
    if (!available || submitting) return;
    const ins = instruction.trim();
    if (!ins) return;
    setSubmitting(true);
    setError(null);
    setResultText(null);
    setStatusText(null);
    setDurationMs(null);
    try {
      const res = await postOpsCursorAgent(ins, context.trim());
      setStatusText(res.status);
      setResultText(res.result?.trim() ? res.result : "(내용 없음)");
      setDurationMs(
        typeof res.durationMs === "number" && Number.isFinite(res.durationMs)
          ? res.durationMs
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.app.opsError);
    } finally {
      setSubmitting(false);
    }
  }, [available, submitting, instruction, context]);

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
