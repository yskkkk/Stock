import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import {
  analyzeLowSignalWinRates,
  type SignalAnalysisInsight,
  type SignalAnalysisMetrics,
} from "../lib/recTrackerSignalAnalysis";
import { ko } from "../i18n/ko";
import type { RecommendationTrackerItem } from "../types";

function formatWinRate(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function formatPct(pct: number | null, signed = false): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const n = pct.toFixed(2);
  if (!signed) return `${n}%`;
  return `${pct >= 0 ? "+" : ""}${n}%`;
}

function metricEntries(m: SignalAnalysisMetrics): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: ko.app.recTrackerMetricShare, value: `${m.poolSharePct.toFixed(0)}%` },
  ];

  if (m.expectancyPct != null) {
    rows.push({
      label: ko.app.recTrackerMetricExpectancy,
      value: formatPct(m.expectancyPct, true),
    });
  }
  if (m.avgWinPct != null) {
    rows.push({ label: ko.app.recTrackerMetricAvgWin, value: formatPct(m.avgWinPct, true) });
  }
  if (m.avgLossPct != null) {
    rows.push({ label: ko.app.recTrackerMetricAvgLoss, value: formatPct(m.avgLossPct, true) });
  }
  if (m.soloDecided >= 3 && m.soloWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricSolo,
      value: `${formatWinRate(m.soloWinRatePct)} (${m.soloDecided})`,
    });
  }
  if (m.multiDecided >= 3 && m.multiWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricMulti,
      value: `${formatWinRate(m.multiWinRatePct)} (${m.multiDecided})`,
    });
  }
  if (m.highScoreDecided >= 3 && m.highScoreWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricHighScore,
      value: `${formatWinRate(m.highScoreWinRatePct)} (${m.highScoreDecided})`,
    });
  }
  if (m.lowScoreDecided >= 3 && m.lowScoreWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricLowScore,
      value: `${formatWinRate(m.lowScoreWinRatePct)} (${m.lowScoreDecided})`,
    });
  }
  if (m.krDecided >= 3 && m.krWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricKr,
      value: `${formatWinRate(m.krWinRatePct)} (${m.krDecided})`,
    });
  }
  if (m.usDecided >= 3 && m.usWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricUs,
      value: `${formatWinRate(m.usWinRatePct)} (${m.usDecided})`,
    });
  }
  rows.push({
    label: ko.app.recTrackerMetricCoCount,
    value: m.avgCoSignalCount.toFixed(1),
  });
  if (m.bigLossSharePct != null && m.bigLossSharePct > 0) {
    rows.push({
      label: ko.app.recTrackerMetricBigLoss,
      value: `${m.bigLossSharePct.toFixed(0)}%`,
    });
  }
  if (m.recentDecided >= 3 && m.recentWinRatePct != null) {
    rows.push({
      label: ko.app.recTrackerMetricRecent,
      value: `${formatWinRate(m.recentWinRatePct)} (${m.recentDecided})`,
    });
  }
  if (m.flatUnknownPct >= 1) {
    rows.push({
      label: ko.app.recTrackerMetricFlat,
      value: `${m.flatUnknownPct.toFixed(0)}%`,
    });
  }

  return rows;
}

function AnalysisItem({
  ins,
  active,
  onToggleSignal,
}: {
  ins: SignalAnalysisInsight;
  active: boolean;
  onToggleSignal: (id: SignalId) => void;
}) {
  const chip = signalChipMeta(ins.signalId);
  const metrics = metricEntries(ins.metrics);

  return (
    <li
      className={
        ins.severity === "low"
          ? "rec-tracker-analysis__item rec-tracker-analysis__item--low"
          : "rec-tracker-analysis__item rec-tracker-analysis__item--watch"
      }
    >
      <div className="rec-tracker-analysis__item-head">
        <span className={`${chip.className} rec-tracker-analysis__tag`}>{ins.short}</span>
        <span className="rec-tracker-analysis__rate">{formatWinRate(ins.winRatePct)}</span>
        <span className="rec-tracker-analysis__delta">{ins.deltaVsBaseline.toFixed(1)}%p</span>
        <span className="rec-tracker-analysis__n">
          {ins.wins}승/{ins.losses}패
        </span>
      </div>
      <dl className="rec-tracker-analysis__metrics">
        {metrics.map((row) => (
          <div key={row.label} className="rec-tracker-analysis__metric">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
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
        onClick={() => onToggleSignal(ins.signalId)}
      >
        {active ? ko.app.recTrackerChipSelected : ko.app.recTrackerAnalysisViewList}
      </button>
    </li>
  );
}

export default function RecTrackerSignalAnalysisPanel({
  itemsPool,
  onToggleSignal,
  activeSignalIds,
}: {
  itemsPool: RecommendationTrackerItem[];
  onToggleSignal: (id: SignalId) => void;
  activeSignalIds: SignalId[];
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
      <p className="rec-tracker-analysis__baseline">
        {ko.app.recTrackerAnalysisBaseline.replace("{rate}", formatWinRate(baseline.winRatePct)).replace(
          "{decided}",
          String(decided),
        )}
      </p>
      <ul className="rec-tracker-analysis__list">
        {insights.map((ins) => (
          <AnalysisItem
            key={ins.signalId}
            ins={ins}
            active={activeSignalIds.includes(ins.signalId)}
            onToggleSignal={onToggleSignal}
          />
        ))}
      </ul>
    </details>
  );
}
