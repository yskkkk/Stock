import { useCallback, useEffect, useMemo, useState } from "react";
import { signalChipMeta } from "../constants/signalChips";
import {
  applyTechWeights,
  fetchTechWeights,
  resetTechWeights,
  type TechWeightsResponse,
} from "../api";
import {
  applyAllTechWeightChanges,
  applySingleTechWeightChange,
  buildTechUpgradePlan,
  changeSummaryLine,
  type TechWeightChange,
} from "../lib/recTrackerTechUpgrade";
import { setTechScoreWeights } from "../lib/techScore";
import { ko } from "../i18n/ko";
import type { RecommendationTrackerItem } from "../types";

function formatWinRate(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function ChangeRow({
  change,
  baselinePct,
  onApply,
  applying,
}: {
  change: TechWeightChange;
  baselinePct: number;
  onApply: (c: TechWeightChange) => void;
  applying: boolean;
}) {
  const chip = signalChipMeta(change.signalId);
  return (
    <li
      className={
        change.kind === "boost"
          ? "rec-tracker-upgrade__item rec-tracker-upgrade__item--boost"
          : "rec-tracker-upgrade__item rec-tracker-upgrade__item--cut"
      }
    >
      <div className="rec-tracker-upgrade__item-head">
        <span className={`${chip.className} rec-tracker-upgrade__tag`}>{change.short}</span>
        <span className="rec-tracker-upgrade__weight">
          {change.from} → {change.to}
        </span>
        <span className="rec-tracker-upgrade__rate">{formatWinRate(change.winRatePct)}</span>
        <span className="rec-tracker-upgrade__n">
          {change.deltaVsBaseline >= 0 ? "+" : ""}
          {change.deltaVsBaseline.toFixed(1)}%p
        </span>
      </div>
      <p className="rec-tracker-upgrade__reason">
        {changeSummaryLine(change, baselinePct)}
      </p>
      <button
        type="button"
        className="btn btn--primary btn--sm rec-tracker-upgrade__apply-one"
        disabled={applying}
        onClick={() => onApply(change)}
      >
        {ko.app.recTrackerUpgradeApplyOne}
      </button>
    </li>
  );
}

export default function RecTrackerTechUpgradePanel({
  itemsPool,
}: {
  itemsPool: RecommendationTrackerItem[];
}) {
  const [weightsState, setWeightsState] = useState<TechWeightsResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const reloadWeights = useCallback(async () => {
    try {
      const w = await fetchTechWeights();
      setWeightsState(w);
      setTechScoreWeights(w.weights);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadWeights();
  }, [reloadWeights]);

  const currentWeights = weightsState?.weights ?? {};
  const plan = useMemo(
    () => buildTechUpgradePlan(itemsPool, currentWeights),
    [itemsPool, currentWeights, weightsState?.revision],
  );

  const decided = plan.baselineDecided;
  const baselinePct = plan.baselineWinRatePct;

  const persistWeights = async (
    next: Record<string, number>,
    msg: string,
  ) => {
    setApplying(true);
    setApplyErr(null);
    setApplyMsg(null);
    try {
      const res = await applyTechWeights({
        weights: next,
        baselineWinRatePct: baselinePct ?? undefined,
      });
      setWeightsState((prev) =>
        prev
          ? {
              ...prev,
              weights: res.weights,
              revision: res.revision,
              maxTechScore: res.maxTechScore,
              updatedAtMs: res.updatedAtMs,
            }
          : null,
      );
      setTechScoreWeights(res.weights);
      setApplyMsg(msg);
      await reloadWeights();
    } catch (e) {
      setApplyErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const onApplyOne = (change: TechWeightChange) => {
    const next = applySingleTechWeightChange(currentWeights, change);
    void persistWeights(
      next,
      ko.app.recTrackerUpgradeAppliedOne.replace("{label}", change.short),
    );
  };

  const onApplyAll = () => {
    if (!plan.changes.length) return;
    const next = applyAllTechWeightChanges(currentWeights, plan.changes);
    void persistWeights(next, ko.app.recTrackerUpgradeAppliedAll);
  };

  const onReset = () => {
    setApplying(true);
    setApplyErr(null);
    setApplyMsg(null);
    void resetTechWeights()
      .then((res) => {
        setWeightsState(res);
        setTechScoreWeights(res.weights);
        setApplyMsg(ko.app.recTrackerUpgradeResetDone);
      })
      .catch((e) => setApplyErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setApplying(false));
  };

  if (loadErr) {
    return (
      <p className="rec-tracker-warn" role="alert">
        {loadErr}
      </p>
    );
  }

  if (decided < 5) return null;

  const revision = weightsState?.revision ?? 0;
  const maxScore = weightsState?.maxTechScore ?? plan.maxTechScore;

  return (
    <section className="rec-tracker-upgrade card" aria-labelledby="rec-tracker-upgrade-title">
      <div className="rec-tracker-upgrade__head">
        <h3 id="rec-tracker-upgrade-title" className="filter-title">
          {ko.app.recTrackerUpgradeTitle}
        </h3>
        {revision > 0 ? (
          <span className="rec-tracker-upgrade__rev">
            {ko.app.recTrackerUpgradeRevision.replace("{n}", String(revision))}
          </span>
        ) : null}
      </div>
      <p className="rec-tracker-upgrade__intro">{ko.app.recTrackerUpgradeIntro}</p>
      {baselinePct != null ? (
        <p className="rec-tracker-upgrade__baseline">
          {ko.app.recTrackerUpgradeBaseline.replace("{rate}", formatWinRate(baselinePct)).replace(
            "{decided}",
            String(decided),
          )}{" "}
          · {ko.app.recTrackerUpgradeMaxScore.replace("{n}", String(maxScore))}
        </p>
      ) : null}

      {plan.headline ? (
        <p className="rec-tracker-upgrade__headline" role="status">
          {ko.app.recTrackerUpgradeHeadline}: {plan.headline}
        </p>
      ) : (
        <p className="rec-tracker-upgrade__empty">{ko.app.recTrackerUpgradeNone}</p>
      )}

      {plan.changes.length > 0 ? (
        <>
          <ul className="rec-tracker-upgrade__list">
            {plan.changes.slice(0, 6).map((c) => (
              <ChangeRow
                key={`${c.signalId}-${c.from}-${c.to}`}
                change={c}
                baselinePct={baselinePct ?? 0}
                onApply={onApplyOne}
                applying={applying}
              />
            ))}
          </ul>
          <div className="rec-tracker-upgrade__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={applying || !plan.changes.length}
              onClick={onApplyAll}
            >
              {ko.app.recTrackerUpgradeApplyAll}
            </button>
            {revision > 0 ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={applying}
                onClick={onReset}
              >
                {ko.app.recTrackerUpgradeReset}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {applyMsg ? (
        <p className="rec-tracker-upgrade__ok" role="status">
          {applyMsg}
        </p>
      ) : null}
      {applyErr ? (
        <p className="rec-tracker-warn" role="alert">
          {applyErr}
        </p>
      ) : null}
    </section>
  );
}
