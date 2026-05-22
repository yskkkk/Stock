import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveTradeHolding } from "../api";
import {
  armLiveTradeProgram,
  createLiveTradeProgram,
  deleteLiveTradeProgram,
  disarmLiveTradeProgram,
  startSimLiveTradeProgram,
  stopSimLiveTradeProgram,
  fetchLiveTradingStatus,
  fetchTechModels,
  updateLiveTradeProgram,
  type LiveTradeProgram,
  type LiveTradingStatusResponse,
  type TechModelRecord,
} from "../api";
import LiveSimRunningPanel from "./LiveSimRunningPanel";
import LiveSimRecommendationsPanel, {
  type LiveSimDraftPatch,
} from "./LiveSimRecommendationsPanel";
import LiveTradePortfolioPanel from "./LiveTradePortfolioPanel";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import { peekLiveTradingPrefetch } from "../lib/tabPrefetch";
import { formatPercent } from "../lib/format";
import { ko } from "../i18n/ko";

function statusLabel(status: LiveTradeProgram["status"]): string {
  switch (status) {
    case "armed":
      return ko.app.liveTradeStatusArmed;
    case "sim":
      return ko.app.liveTradeStatusSim;
    case "paused":
      return ko.app.liveTradeStatusPaused;
    case "error":
      return ko.app.liveTradeStatusError;
    default:
      return ko.app.liveTradeStatusDraft;
  }
}

function formatMoney(n: number | null, currency: "krw" | "usd"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (currency === "krw") {
    return `${Math.round(n).toLocaleString("ko-KR")}원`;
  }
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatTs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

/** @returns {number | null} 1~50 정수, 빈 값·0·비정상이면 null */
function parseMaxOpenPositionsInput(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 50) return null;
  return n;
}

const emptyDraft = () => ({
  name: "",
  modelId: "",
  marketsKr: true,
  marketsUs: false,
  minScoreRatio: 0.85,
  maxOpenPositions: "5",
  orderAmountKrw: "100000",
  orderAmountUsd: "",
  simAutoBuy: true,
  autoSellAtTarget: true,
});

export default function LiveTradingTab({
  onOpenRecommendations,
  onOpenHoldingChart,
  chartPickKey,
}: {
  onOpenRecommendations?: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
  chartPickKey?: string | null;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const [status, setStatus] = useState<LiveTradingStatusResponse | null>(
    () => prefetched?.status ?? null,
  );
  const [models, setModels] = useState<TechModelRecord[]>(
    () => prefetched?.techModels.models ?? [],
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [st, tm] = await Promise.all([
        fetchLiveTradingStatus(),
        fetchTechModels(),
      ]);
      setStatus(st);
      setModels(tm.models);
      setLoadErr(null);
      setDraft((d) => ({
        ...d,
        modelId:
          d.modelId && tm.models.some((m) => m.id === d.modelId)
            ? d.modelId
            : tm.models[0]?.id ?? "",
      }));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (portfolioRefreshKey > 0) void reload();
  }, [portfolioRefreshKey, reload]);

  useEffect(() => {
    const active =
      (status?.simCount ?? 0) + (status?.armedCount ?? 0) > 0;
    if (!active) return;
    const id = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(id);
  }, [reload, status?.simCount, status?.armedCount]);

  const modelById = useMemo(() => {
    const m = new Map<string, TechModelRecord>();
    for (const x of models) m.set(x.id, x);
    return m;
  }, [models]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setDraft({
      ...emptyDraft(),
      modelId: models[0]?.id ?? "",
    });
    setMsg(null);
    setErr(null);
  }, [models]);

  useMobileBackHandler(
    Boolean(editingId),
    MOBILE_BACK_PRIORITY.LIVE_TRADE_EDIT,
    resetForm,
  );

  const loadProgramToForm = useCallback((p: LiveTradeProgram) => {
    setEditingId(p.id);
    setDraft({
      name: p.name,
      modelId: p.modelId,
      marketsKr: p.markets.kr,
      marketsUs: p.markets.us,
      minScoreRatio: p.minScoreRatio,
      maxOpenPositions: String(p.maxOpenPositions),
      orderAmountKrw:
        p.orderAmountKrw != null ? String(Math.round(p.orderAmountKrw)) : "",
      orderAmountUsd:
        p.orderAmountUsd != null ? String(p.orderAmountUsd) : "",
      simAutoBuy: p.simAutoBuy !== false,
      autoSellAtTarget: p.autoSellAtTarget !== false,
    });
    setMsg(null);
    setErr(null);
  }, []);

  const buildBody = useCallback(() => {
    const orderKrw = draft.orderAmountKrw.trim();
    const orderUsd = draft.orderAmountUsd.trim();
    const maxOpenPositions = parseMaxOpenPositionsInput(draft.maxOpenPositions)!;
    return {
      name: draft.name.trim(),
      modelId: draft.modelId,
      markets: { kr: draft.marketsKr, us: draft.marketsUs },
      minScoreRatio: draft.minScoreRatio,
      maxOpenPositions,
      orderAmountKrw: orderKrw ? Number(orderKrw) : null,
      orderAmountUsd: orderUsd ? Number(orderUsd) : null,
      simAutoBuy: draft.simAutoBuy,
      autoSellAtTarget: draft.autoSellAtTarget,
    };
  }, [draft]);

  const handleSave = useCallback(async () => {
    setErr(null);
    setMsg(null);
    if (parseMaxOpenPositionsInput(draft.maxOpenPositions) == null) {
      setErr(ko.app.liveTradeFieldMaxPosInvalid);
      return;
    }
    setBusy(true);
    try {
      const body = buildBody();
      if (editingId) {
        await updateLiveTradeProgram(editingId, body);
        setMsg(ko.app.liveTradeSaved);
      } else {
        await createLiveTradeProgram(body);
        setMsg(ko.app.liveTradeRegistered);
        resetForm();
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [buildBody, draft.maxOpenPositions, editingId, reload, resetForm]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(ko.app.liveTradeDeleteConfirm)) return;
      setBusy(true);
      setErr(null);
      try {
        await deleteLiveTradeProgram(id);
        if (editingId === id) resetForm();
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [editingId, reload, resetForm],
  );

  const handleArm = useCallback(
    async (id: string) => {
      setBusy(true);
      setErr(null);
      setMsg(null);
      try {
        const out = await armLiveTradeProgram(id);
        setMsg(
          out.toss.ready
            ? ko.app.liveTradeArmedOk
            : ko.app.liveTradeArmedWaitToss,
        );
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const handleSimStart = useCallback(
    async (id: string) => {
      setBusy(true);
      setErr(null);
      setMsg(null);
      try {
        await startSimLiveTradeProgram(id);
        setMsg(ko.app.liveTradeSimStartOk);
        await reload();
        setPortfolioRefreshKey((k) => k + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const handleSimStop = useCallback(
    async (id: string) => {
      setBusy(true);
      setErr(null);
      try {
        await stopSimLiveTradeProgram(id);
        await reload();
        setPortfolioRefreshKey((k) => k + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const handleDisarm = useCallback(
    async (id: string) => {
      setBusy(true);
      setErr(null);
      try {
        await disarmLiveTradeProgram(id);
        setMsg(ko.app.liveTradeDisarmed);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const programs = status?.programs ?? [];
  const toss = status?.toss;

  return (
    <div className="live-trading-tab live-trading-panel">
      <header className="live-trading-tab__head card">
        <div>
          <h2 className="live-trading-tab__title">{ko.app.liveTradeTitle}</h2>
        </div>
        {onOpenRecommendations ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onOpenRecommendations}
          >
            {ko.app.liveTradeOpenRecModels}
          </button>
        ) : null}
      </header>

      {loadErr ? (
        <div className="alert alert--error" role="alert">
          {loadErr}
        </div>
      ) : null}

      <section
        className={`live-trading-tab__toss card ${
          toss?.ready
            ? "live-trading-tab__toss--ready"
            : toss?.configured
              ? "live-trading-tab__toss--partial"
              : "live-trading-tab__toss--off"
        }`}
        aria-live="polite"
      >
        <h3 className="live-trading-tab__section-title">{ko.app.liveTradeTossTitle}</h3>
        <p className="live-trading-tab__toss-msg">{toss?.messageKo ?? "—"}</p>
        <ul className="live-trading-tab__toss-env" aria-label={ko.app.liveTradeTossChecklist}>
          <li>
            <span>{ko.app.liveTradeTossItemApi}</span>
            <span className="live-trading-tab__toss-state">
              {toss?.configured ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
            </span>
          </li>
          <li>
            <span>{ko.app.liveTradeTossItemAccount}</span>
            <span className="live-trading-tab__toss-state">
              {toss?.ready ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
            </span>
          </li>
          <li>
            <span>{ko.app.liveTradeTossItemOrders}</span>
            <span className="live-trading-tab__toss-state">
              {status?.simulatedOrders === false
                ? ko.app.liveTradeTossOk
                : ko.app.liveTradeTossSim}
            </span>
          </li>
        </ul>
      </section>

      <LiveSimRunningPanel
        programs={programs}
        busy={busy}
        refreshKey={portfolioRefreshKey}
        onStop={(id) => void handleSimStop(id)}
        onProgramUpdated={() => void reload()}
        onOpenHoldingChart={onOpenHoldingChart}
        chartPickKey={chartPickKey}
      />

      <LiveTradePortfolioPanel
        programs={programs}
        onOpenHoldingChart={onOpenHoldingChart}
        chartPickKey={chartPickKey}
      />

      <div className="live-trading-tab__grid">
        <section className="live-trading-tab__form card" aria-label={ko.app.liveTradeFormTitle}>
          <h3 className="live-trading-tab__section-title">
            {editingId ? ko.app.liveTradeFormEdit : ko.app.liveTradeFormNew}
          </h3>

          {models.length === 0 ? (
            <p className="live-trading-tab__hint">{ko.app.liveTradeNoModels}</p>
          ) : (
            <>
              {!editingId ? (
                <LiveSimRecommendationsPanel
                  onApplyPatch={(patch: LiveSimDraftPatch) => {
                    setDraft((d) => ({
                      ...d,
                      modelId: patch.modelId ?? d.modelId,
                      marketsKr: patch.marketsKr ?? d.marketsKr,
                      marketsUs: patch.marketsUs ?? d.marketsUs,
                      minScoreRatio: patch.minScoreRatio ?? d.minScoreRatio,
                      maxOpenPositions:
                        patch.maxOpenPositions != null
                          ? String(patch.maxOpenPositions)
                          : d.maxOpenPositions,
                      orderAmountKrw: patch.orderAmountKrw ?? d.orderAmountKrw,
                      orderAmountUsd: patch.orderAmountUsd ?? d.orderAmountUsd,
                      simAutoBuy: patch.simAutoBuy ?? d.simAutoBuy,
                      autoSellAtTarget:
                        patch.autoSellAtTarget ?? d.autoSellAtTarget,
                    }));
                    setMsg(ko.app.liveTradeSimRecApply);
                  }}
                />
              ) : null}

              <label className="live-trading-tab__field">
                <span>{ko.app.liveTradeFieldName}</span>
                <input
                  type="text"
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder={ko.app.liveTradeNamePlaceholder}
                />
              </label>

              <label className="live-trading-tab__field">
                <span>{ko.app.liveTradeFieldModel}</span>
                <select
                  className="input"
                  value={draft.modelId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, modelId: e.target.value }))
                  }
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} (max {m.maxTechScore}점)
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="live-trading-tab__markets">
                <legend>{ko.app.liveTradeFieldMarkets}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.marketsKr}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, marketsKr: e.target.checked }))
                    }
                  />
                  {ko.app.liveTradeMarketKr}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.marketsUs}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, marketsUs: e.target.checked }))
                    }
                  />
                  {ko.app.liveTradeMarketUs}
                </label>
              </fieldset>

              <label className="live-trading-tab__field">
                <span>{ko.app.liveTradeFieldMinScore}</span>
                <input
                  type="range"
                  min={0.7}
                  max={1}
                  step={0.01}
                  value={draft.minScoreRatio}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      minScoreRatio: Number(e.target.value),
                    }))
                  }
                />
                <span className="live-trading-tab__range-val">
                  {Math.round(draft.minScoreRatio * 100)}%
                </span>
              </label>

              <label className="live-trading-tab__field">
                <span>{ko.app.liveTradeFieldMaxPos}</span>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={50}
                  inputMode="numeric"
                  value={draft.maxOpenPositions}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maxOpenPositions: e.target.value,
                    }))
                  }
                />
              </label>

              <label className="live-trading-tab__field">
                <span>{ko.app.liveTradeFieldAmountKrw}</span>
                <input
                  type="number"
                  className="input"
                  min={10000}
                  step={10000}
                  value={draft.orderAmountKrw}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, orderAmountKrw: e.target.value }))
                  }
                  disabled={!draft.marketsKr}
                />
              </label>

              <label className="live-trading-tab__field live-trading-tab__field--check">
                <input
                  type="checkbox"
                  checked={draft.simAutoBuy}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, simAutoBuy: e.target.checked }))
                  }
                />
                <span>{ko.app.liveTradeFieldSimAutoBuy}</span>
              </label>

              <label className="live-trading-tab__field live-trading-tab__field--check">
                <input
                  type="checkbox"
                  checked={draft.autoSellAtTarget}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, autoSellAtTarget: e.target.checked }))
                  }
                />
                <span>{ko.app.liveTradeFieldAutoSell}</span>
              </label>
              <p className="live-trading-tab__hint">{ko.app.liveTradeAutoExitHint}</p>

              <label className="live-trading-tab__field">
                <span>{ko.app.liveTradeFieldAmountUsd}</span>
                <input
                  type="number"
                  className="input"
                  min={10}
                  step={10}
                  value={draft.orderAmountUsd}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, orderAmountUsd: e.target.value }))
                  }
                  disabled={!draft.marketsUs}
                />
              </label>

              <div className="live-trading-tab__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !draft.name.trim() || !draft.modelId}
                  onClick={() => void handleSave()}
                >
                  {editingId ? ko.app.liveTradeSave : ko.app.liveTradeRegister}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={resetForm}
                  >
                    {ko.app.liveTradeCancelEdit}
                  </button>
                ) : null}
              </div>
            </>
          )}

          {msg ? (
            <p className="live-trading-tab__ok" role="status">
              {msg}
            </p>
          ) : null}
          {err ? (
            <p className="live-trading-tab__err" role="alert">
              {err}
            </p>
          ) : null}
        </section>

        <section className="live-trading-tab__list card" aria-label={ko.app.liveTradeListTitle}>
          <h3 className="live-trading-tab__section-title">
            {ko.app.liveTradeListTitle}
            {programs.length > 0 ? (
              <span className="live-trading-tab__count">{programs.length}</span>
            ) : null}
          </h3>

          {programs.length === 0 ? (
            <p className="live-trading-tab__empty">{ko.app.liveTradeListEmpty}</p>
          ) : (
            <ul className="live-trading-tab__programs">
              {programs.map((p) => {
                const model = modelById.get(p.modelId);
                const ret = status?.programReturns?.[p.id];
                const returnPct = ret?.totalReturnPct;
                const returnClass =
                  returnPct == null
                    ? "live-trading-tab__program-return-val"
                    : returnPct >= 0
                      ? "live-trading-tab__program-return-val live-trading-tab__program-return-val--up"
                      : "live-trading-tab__program-return-val live-trading-tab__program-return-val--down";
                return (
                  <li
                    key={p.id}
                    className={`live-trading-tab__program live-trading-tab__program--${p.status}`}
                  >
                    <div className="live-trading-tab__program-head">
                      <strong>{p.name}</strong>
                      <span className={`live-trading-tab__badge live-trading-tab__badge--${p.status}`}>
                        {statusLabel(p.status)}
                      </span>
                    </div>
                    <p className="live-trading-tab__program-meta">
                      {ko.app.liveTradeFieldModel}: {model?.name ?? p.modelId}
                    </p>
                    <p className="live-trading-tab__program-meta">
                      {p.markets.kr ? ko.app.liveTradeMarketKr : ""}
                      {p.markets.kr && p.markets.us ? " · " : ""}
                      {p.markets.us ? ko.app.liveTradeMarketUs : ""}
                      {" · "}
                      {ko.app.liveTradeMinScoreShort}: {Math.round(p.minScoreRatio * 100)}%
                    </p>
                    <p className="live-trading-tab__program-meta">
                      {p.markets.kr
                        ? `${ko.app.liveTradeFieldAmountKrw}: ${formatMoney(p.orderAmountKrw, "krw")}`
                        : ""}
                      {p.markets.us
                        ? ` · ${ko.app.liveTradeFieldAmountUsd}: ${formatMoney(p.orderAmountUsd, "usd")}`
                        : ""}
                    </p>
                    <p className="live-trading-tab__program-meta live-trading-tab__program-return">
                      {ko.app.liveTradeCurrentReturn}:{" "}
                      <span className={returnClass}>
                        {formatPercent(returnPct ?? undefined)}
                      </span>
                    </p>
                    {p.lastError ? (
                      <p className="live-trading-tab__program-err">{p.lastError}</p>
                    ) : null}
                    <p className="live-trading-tab__program-ts">
                      {p.status === "armed" && p.armedAtMs
                        ? `${ko.app.liveTradeArmedAt}: ${formatTs(p.armedAtMs)}`
                        : null}
                      {p.lastRunAtMs
                        ? ` · ${ko.app.liveTradeLastRun}: ${formatTs(p.lastRunAtMs)}`
                        : null}
                    </p>
                    <div className="live-trading-tab__program-actions">
                      {p.status === "sim" ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void handleSimStop(p.id)}
                        >
                          {ko.app.liveTradeSimStop}
                        </button>
                      ) : p.status === "armed" ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => void handleDisarm(p.id)}
                        >
                          {ko.app.liveTradeDisarm}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={busy}
                            onClick={() => void handleSimStart(p.id)}
                          >
                            {ko.app.liveTradeSimStart}
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={busy}
                            onClick={() => void handleArm(p.id)}
                          >
                            {ko.app.liveTradeArm}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => loadProgramToForm(p)}
                      >
                        {ko.app.liveTradeEdit}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void handleDelete(p.id)}
                      >
                        {ko.app.liveTradeDelete}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
