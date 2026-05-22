import { useCallback, useEffect, useState } from "react";
import {
  applyLiveSimFeedback,
  fetchLiveSimFeedback,
  type LiveSimFeedbackResponse,
} from "../api";
import { ko } from "../i18n/ko";

export default function LiveSimFeedbackBlock({
  programId,
  refreshKey = 0,
  onApplied,
}: {
  programId: string;
  refreshKey?: number;
  onApplied?: () => void;
}) {
  const [data, setData] = useState<LiveSimFeedbackResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const fb = await fetchLiveSimFeedback(programId);
      setData(fb);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleApply = async () => {
    setBusy(true);
    setOkMsg(null);
    setErr(null);
    try {
      const res = await applyLiveSimFeedback(programId);
      setData(res.analysis);
      setOkMsg(ko.app.liveTradeSimFeedbackApplied);
      onApplied?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) {
    return (
      <p className="live-sim-run__err" role="alert">
        {err}
      </p>
    );
  }

  if (!data) return null;

  return (
    <section
      className="live-sim-run__feedback"
      aria-label={ko.app.liveTradeSimFeedbackTitle}
    >
      <h5 className="live-sim-run__sub">{ko.app.liveTradeSimFeedbackTitle}</h5>
      <p className="live-sim-run__feedback-msg">{data.message}</p>

      {data.winFactors.length > 0 ? (
        <>
          <h6 className="live-sim-run__feedback-k">{ko.app.liveTradeSimFeedbackWin}</h6>
          <ul className="live-sim-run__feedback-list live-sim-run__feedback-list--win">
            {data.winFactors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}

      {data.lossFactors.length > 0 ? (
        <>
          <h6 className="live-sim-run__feedback-k">{ko.app.liveTradeSimFeedbackLoss}</h6>
          <ul className="live-sim-run__feedback-list live-sim-run__feedback-list--loss">
            {data.lossFactors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}

      {data.applyItems.length > 0 ? (
        <ul className="live-sim-run__apply-preview">
          {data.applyItems.map((item) => (
            <li key={item.field}>
              <strong>{item.label}</strong> — {item.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="live-sim-run__feedback-actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy || data.applyItems.length === 0}
          onClick={() => void handleApply()}
        >
          {busy ? ko.app.liveTradeSimFeedbackApplying : ko.app.liveTradeSimFeedbackApply}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => void load()}
        >
          {ko.app.liveTradePfRefresh}
        </button>
      </div>

      {data.applyItems.length === 0 && data.ready ? (
        <p className="live-sim-run__muted">{ko.app.liveTradeSimFeedbackNoApply}</p>
      ) : null}

      {okMsg ? (
        <p className="live-sim-run__ok" role="status">
          {okMsg}
        </p>
      ) : null}
      {err ? (
        <p className="live-sim-run__err" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}
