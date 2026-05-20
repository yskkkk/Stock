import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import { analyzeLowSignalWinRates } from "../lib/recTrackerSignalAnalysis";
import { ko } from "../i18n/ko";
import type { RecommendationTrackerItem } from "../types";

function formatWinRate(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

export default function RecTrackerSignalAnalysisPanel({
  itemsPool,
  onFocusSignal,
  activeSignalId,
}: {
  itemsPool: RecommendationTrackerItem[];
  onFocusSignal: (id: SignalId | null) => void;
  activeSignalId: SignalId | null;
}) {
  const { baseline, insights } = analyzeLowSignalWinRates(itemsPool);
  const decided = baseline.wins + baseline.losses;

  if (!insights.length) {
    if (decided < 8) return null;
    return (
      <details className="rec-tracker-analysis">
        <summary className="rec-tracker-analysis__summary">
          {ko.app.recTrackerAnalysisTitle}
        </summary>
        <p className="rec-tracker-analysis__empty">{ko.app.recTrackerAnalysisNone}</p>
      </details>
    );
  }

  return (
    <details className="rec-tracker-analysis">
      <summary className="rec-tracker-analysis__summary">
        {ko.app.recTrackerAnalysisTitle}
        <span className="rec-tracker-analysis__badge">{insights.length}</span>
      </summary>
      <p className="rec-tracker-analysis__intro">{ko.app.recTrackerAnalysisIntro}</p>
      <p className="rec-tracker-analysis__baseline">
        {ko.app.recTrackerAnalysisBaseline.replace("{rate}", formatWinRate(baseline.winRatePct)).replace(
          "{decided}",
          String(decided),
        )}
      </p>
      <ul className="rec-tracker-analysis__list">
        {insights.map((ins) => {
          const chip = signalChipMeta(ins.signalId);
          const active = activeSignalId === ins.signalId;
          return (
            <li
              key={ins.signalId}
              className={
                ins.severity === "low"
                  ? "rec-tracker-analysis__item rec-tracker-analysis__item--low"
                  : "rec-tracker-analysis__item rec-tracker-analysis__item--watch"
              }
            >
              <div className="rec-tracker-analysis__item-head">
                <span className={`${chip.className} rec-tracker-analysis__tag`}>{ins.short}</span>
                <span className="rec-tracker-analysis__rate">{formatWinRate(ins.winRatePct)}</span>
                <span className="rec-tracker-analysis__delta">
                  {ins.deltaVsBaseline.toFixed(1)}%p
                </span>
                <span className="rec-tracker-analysis__n">
                  {ins.wins}승/{ins.losses}패
                </span>
              </div>
              <ul className="rec-tracker-analysis__bullets">
                {ins.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <button
                type="button"
                className={
                  active
                    ? "rec-tracker-analysis__link rec-tracker-analysis__link--active"
                    : "rec-tracker-analysis__link"
                }
                aria-pressed={active}
                onClick={() => onFocusSignal(active ? null : ins.signalId)}
              >
                {active ? ko.app.recTrackerChipSelected : ko.app.recTrackerAnalysisViewList}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
