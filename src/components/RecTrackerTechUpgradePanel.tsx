import { useCallback, useEffect, useMemo, useState } from "react";
import { signalChipMeta } from "../constants/signalChips";
import {
  createTechModel,
  fetchTechModels,
  resetTechWeights,
  setActiveTechModelIds,
  updateTechModel,
  type TechModelRecord,
  type TechModelsResponse,
} from "../api";
import {
  applyAllTechWeightChanges,
  applySingleTechWeightChange,
  buildTechUpgradePlan,
  type TechWeightChange,
} from "../lib/recTrackerTechUpgrade";
import { setTechScoreWeights } from "../lib/techScore";
import { ko } from "../i18n/ko";
import type { RecommendationTrackerItem } from "../types";

const DEFAULT_TECH_MODEL_ID = "default";
const FORK_MODEL_NAME = "승률 조정";

function formatWinRate(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function formatDeltaPp(delta: number, kind: TechWeightChange["kind"]): string {
  const sign = kind === "boost" ? "+" : "";
  return `${sign}${delta.toFixed(1)}%p`;
}

function ChangeRow({
  change,
  onApply,
  applying,
}: {
  change: TechWeightChange;
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
      <div className="rec-tracker-upgrade__item-main">
        <span className={`${chip.className} rec-tracker-upgrade__tag`}>{change.short}</span>
        <span className="rec-tracker-upgrade__weight">
          {change.from}→{change.to}
        </span>
        <span className="rec-tracker-upgrade__rate">{formatWinRate(change.winRatePct)}</span>
        <span className="rec-tracker-upgrade__delta">
          {formatDeltaPp(Math.abs(change.deltaVsBaseline), change.kind)}
        </span>
      </div>
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
  const [modelsState, setModelsState] = useState<TechModelsResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [targetModelId, setTargetModelId] = useState<string>("");
  const [newModelName, setNewModelName] = useState("");

  const reloadModels = useCallback(async () => {
    try {
      const m = await fetchTechModels();
      setModelsState(m);
      setLoadErr(null);
      const primary = m.activeModelIds[0] ?? m.models[0]?.id ?? "";
      setTargetModelId((prev) =>
        prev && m.models.some((x) => x.id === prev) ? prev : primary,
      );
      const active = m.models.find((x) => x.id === (m.activeModelIds[0] ?? primary));
      if (active) setTechScoreWeights(active.weights);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadModels();
  }, [reloadModels]);

  const targetModel = useMemo(
    () => modelsState?.models.find((m) => m.id === targetModelId) ?? null,
    [modelsState, targetModelId],
  );

  const plan = useMemo(
    () =>
      targetModel
        ? buildTechUpgradePlan(itemsPool, targetModel.weights)
        : {
            baselineWinRatePct: null,
            baselineDecided: 0,
            maxTechScore: 0,
            changes: [],
            headline: null,
          },
    [itemsPool, targetModel],
  );

  const toggleActive = (id: string) => {
    if (!modelsState) return;
    const set = new Set(modelsState.activeModelIds);
    if (set.has(id)) {
      if (set.size <= 1) return;
      set.delete(id);
    } else {
      set.add(id);
    }
    void setActiveTechModelIds([...set])
      .then((res) => {
        setModelsState(res);
        setApplyMsg(ko.app.recTrackerModelsActiveSaved);
      })
      .catch((e) => setApplyErr(e instanceof Error ? e.message : String(e)));
  };

  const ensureEditableTargetId = useCallback(async (): Promise<string | null> => {
    if (!modelsState) return null;
    if (targetModelId && targetModelId !== DEFAULT_TECH_MODEL_ID) {
      return targetModelId;
    }
    const forked = modelsState.models.find(
      (m) => m.id !== DEFAULT_TECH_MODEL_ID && m.name === FORK_MODEL_NAME,
    );
    if (forked) {
      setTargetModelId(forked.id);
      return forked.id;
    }
    const res = await createTechModel({
      name: FORK_MODEL_NAME,
      copyFromId: DEFAULT_TECH_MODEL_ID,
    });
    setModelsState(res);
    setTargetModelId(res.model.id);
    setApplyMsg(ko.app.recTrackerUpgradeForked);
    return res.model.id;
  }, [modelsState, targetModelId]);

  const persistTargetWeights = async (
    next: Record<string, number>,
    msg: string,
  ) => {
    setApplying(true);
    setApplyErr(null);
    setApplyMsg(null);
    try {
      const editId = await ensureEditableTargetId();
      if (!editId) return;
      const res = await updateTechModel(editId, { weights: next });
      setModelsState(res);
      const updated = res.models.find((m) => m.id === editId);
      if (updated) setTechScoreWeights(updated.weights);
      setApplyMsg(msg);
    } catch (e) {
      setApplyErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const onApplyOne = (change: TechWeightChange) => {
    const model =
      targetModel ??
      modelsState?.models.find((m) => m.id === DEFAULT_TECH_MODEL_ID) ??
      null;
    if (!model) return;
    const next = applySingleTechWeightChange(model.weights, change);
    void persistTargetWeights(
      next,
      ko.app.recTrackerUpgradeAppliedOne.replace("{label}", change.short),
    );
  };

  const onApplyAll = () => {
    const model =
      targetModel ??
      modelsState?.models.find((m) => m.id === DEFAULT_TECH_MODEL_ID) ??
      null;
    if (!model || !plan.changes.length) return;
    const next = applyAllTechWeightChanges(model.weights, plan.changes);
    void persistTargetWeights(next, ko.app.recTrackerUpgradeAppliedAll);
  };

  const onResetDefaults = () => {
    setApplying(true);
    setApplyErr(null);
    setApplyMsg(null);
    void resetTechWeights()
      .then(() => reloadModels())
      .then(() => setApplyMsg(ko.app.recTrackerUpgradeResetDone))
      .catch((e) => setApplyErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setApplying(false));
  };

  const onSaveNewModel = () => {
    const name = newModelName.trim();
    if (!name || !targetModel) return;
    setApplying(true);
    void createTechModel({ name, copyFromId: targetModel.id })
      .then((res) => {
        setModelsState(res);
        setNewModelName("");
        setTargetModelId(res.model.id);
        setApplyMsg(ko.app.recTrackerModelsCreated.replace("{name}", res.model.name));
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

  if (!modelsState || plan.baselineDecided < 5) return null;

  const activeSet = new Set(modelsState.activeModelIds);
  const baselineLabel =
    plan.baselineWinRatePct != null
      ? ko.app.recTrackerUpgradeBaseline.replace(
          "{rate}",
          formatWinRate(plan.baselineWinRatePct),
        ).replace("{decided}", String(plan.baselineDecided))
      : null;

  return (
    <section className="rec-tracker-upgrade card" aria-labelledby="rec-tracker-upgrade-title">
      <div className="rec-tracker-upgrade__head">
        <h3 id="rec-tracker-upgrade-title" className="filter-title">
          {ko.app.recTrackerUpgradeTitle}
        </h3>
        {baselineLabel ? (
          <span className="rec-tracker-upgrade__stat">{baselineLabel}</span>
        ) : null}
      </div>

      <div className="rec-tracker-upgrade__controls">
        <div className="rec-tracker-upgrade__active">
          <span className="rec-tracker-models__label">{ko.app.recTrackerModelsActive}</span>
          <div className="rec-tracker-upgrade__active-chips">
            {modelsState.models.map((m: TechModelRecord) => (
              <label key={m.id} className="rec-tracker-upgrade__active-chip">
                <input
                  type="checkbox"
                  checked={activeSet.has(m.id)}
                  disabled={activeSet.has(m.id) && activeSet.size <= 1}
                  onChange={() => toggleActive(m.id)}
                />
                <span className="rec-tracker-upgrade__active-name">{m.name}</span>
                <span className="rec-tracker-upgrade__active-meta">
                  {ko.app.recTrackerUpgradeMaxScore.replace("{n}", String(m.maxTechScore))}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="rec-tracker-upgrade__target-row">
          <label className="rec-tracker-upgrade__target-select">
            <span>{ko.app.recTrackerModelsEditTarget}</span>
            <select
              value={targetModelId}
              onChange={(e) => setTargetModelId(e.target.value)}
            >
              {modelsState.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="rec-tracker-upgrade__new-model">
            <input
              type="text"
              value={newModelName}
              placeholder={ko.app.recTrackerModelsNewNamePh}
              onChange={(e) => setNewModelName(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={applying || !newModelName.trim()}
              onClick={onSaveNewModel}
            >
              {ko.app.recTrackerModelsSaveAs}
            </button>
          </div>
        </div>
        {targetModelId === DEFAULT_TECH_MODEL_ID ? (
          <p className="rec-tracker-upgrade__hint">{ko.app.recTrackerUpgradeDefaultHint}</p>
        ) : null}
      </div>

      {plan.changes.length === 0 ? (
        <p className="rec-tracker-upgrade__empty">{ko.app.recTrackerUpgradeNone}</p>
      ) : (
        <>
          {plan.headline ? (
            <p className="rec-tracker-upgrade__headline" role="status">
              <span className="rec-tracker-upgrade__headline-k">{ko.app.recTrackerUpgradeHeadline}</span>
              {plan.headline}
            </p>
          ) : null}
          <ul className="rec-tracker-upgrade__list">
            {plan.changes.slice(0, 6).map((c) => (
              <ChangeRow
                key={`${c.signalId}-${c.from}-${c.to}`}
                change={c}
                onApply={onApplyOne}
                applying={applying}
              />
            ))}
          </ul>
          <div className="rec-tracker-upgrade__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={applying}
              onClick={onApplyAll}
            >
              {ko.app.recTrackerUpgradeApplyAll}
            </button>
            <button
              type="button"
              className="btn btn--ghost rec-tracker-upgrade__reset"
              disabled={applying}
              onClick={onResetDefaults}
            >
              {ko.app.recTrackerUpgradeReset}
            </button>
          </div>
        </>
      )}

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
