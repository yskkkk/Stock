import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthUser, LiveTradeHolding } from "../api";
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
  type LiveTradeArmLane,
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
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { invalidateLiveTradingPrefetch, peekLiveTradingPrefetch } from "../lib/tabPrefetch";
import { formatPercent } from "../lib/format";
import LiveTradeAuthPanel, {
  LiveTradeBithumbCredentialForm,
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";
import {
  programDisplayStatus,
  showProgramRunError,
} from "../lib/liveProgramDisplay";
import { ko } from "../i18n/ko";
import { LiveTradeFeeRatesProvider } from "../contexts/LiveTradeFeeRatesContext";

/** 실매매 중 한 채널(빗썸/토스)이 켜져 있으면 다른 «시작» 버튼 숨김 */
function showArmLaneButton(p: LiveTradeProgram, lane: LiveTradeArmLane): boolean {
  const cryptoArmed = Boolean(p.armedMarkets?.crypto);
  const krArmed = Boolean(p.armedMarkets?.kr);
  if (lane === "bithumb") {
    if (!p.markets.crypto || cryptoArmed) return false;
    if (p.status === "armed" && krArmed) return false;
    return true;
  }
  if (!p.markets.kr || p.markets.us || krArmed) return false;
  if (p.status === "armed" && cryptoArmed) return false;
  return true;
}

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

function usdAmountFieldLabel(marketsUs: boolean, marketsCrypto: boolean): string {
  if (marketsUs && marketsCrypto) return ko.app.liveTradeFieldAmountUsdCrypto;
  return ko.app.liveTradeFieldAmountUsd;
}

function krwAmountFieldLabel(marketsKr: boolean, marketsCrypto: boolean): string {
  if (marketsKr && marketsCrypto) return ko.app.liveTradeFieldAmountKrwCrypto;
  if (marketsCrypto) return ko.app.liveTradeFieldAmountCrypto;
  return ko.app.liveTradeFieldAmountKrw;
}

const emptyDraft = () => ({
  name: "",
  modelId: "",
  marketsKr: true,
  marketsUs: false,
  marketsCrypto: false,
  minScoreRatio: 0.85,
  maxOpenPositions: "5",
  orderAmountKrw: "100000",
  orderAmountUsd: "",
  simAutoBuy: true,
  autoSellAtTarget: true,
  sellHorizon: "short" as "short" | "medium" | "long",
});

export default function LiveTradingTab({
  onOpenRecommendations,
  onOpenHoldingChart,
}: {
  onOpenRecommendations?: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const { user, registrationOpen, authChecked, refreshAuth } =
    useLiveTradeAuth();
  const [status, setStatus] = useState<LiveTradingStatusResponse | null>(
    () => (user ? prefetched?.status ?? null : null),
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

  const reload = useCallback(async (userOverride?: AuthUser | null) => {
    const activeUser = userOverride !== undefined ? userOverride : user;
    if (!activeUser) {
      setStatus(null);
      return;
    }
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
      const msg = e instanceof Error ? e.message : String(e);
      setLoadErr(msg);
      if (msg.includes("로그인")) setStatus(null);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

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
      marketsCrypto: p.markets.crypto,
      minScoreRatio: p.minScoreRatio,
      maxOpenPositions: String(p.maxOpenPositions),
      orderAmountKrw:
        p.orderAmountKrw != null ? String(Math.round(p.orderAmountKrw)) : "",
      orderAmountUsd:
        p.orderAmountUsd != null ? String(p.orderAmountUsd) : "",
      simAutoBuy: p.simAutoBuy !== false,
      autoSellAtTarget: p.autoSellAtTarget !== false,
      sellHorizon: p.sellHorizon ?? "short",
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
      markets: {
        kr: draft.marketsKr,
        us: draft.marketsUs,
        crypto: draft.marketsCrypto,
      },
      minScoreRatio: draft.minScoreRatio,
      maxOpenPositions,
      orderAmountKrw:
        (draft.marketsKr || (draft.marketsCrypto && !draft.marketsUs)) && orderKrw
          ? Number(orderKrw)
          : null,
      orderAmountUsd:
        draft.marketsUs && orderUsd ? Number(orderUsd) : null,
      simAutoBuy: draft.simAutoBuy,
      autoSellAtTarget: draft.autoSellAtTarget,
      sellHorizon: draft.sellHorizon,
    };
  }, [draft]);

  const handleSave = useCallback(async () => {
    setErr(null);
    setMsg(null);
    if (parseMaxOpenPositionsInput(draft.maxOpenPositions) == null) {
      setErr(ko.app.liveTradeFieldMaxPosInvalid);
      return;
    }
    if (!draft.marketsKr && !draft.marketsUs && !draft.marketsCrypto) {
      setErr(ko.app.liveTradeFieldMarketsRequired);
      return;
    }
    if (
      (draft.marketsKr || (draft.marketsCrypto && !draft.marketsUs)) &&
      !draft.orderAmountKrw.trim()
    ) {
      setErr(krwAmountFieldLabel(draft.marketsKr, draft.marketsCrypto));
      return;
    }
    const orderKrwNum = Number(draft.orderAmountKrw.trim());
    if (
      (draft.marketsKr || (draft.marketsCrypto && !draft.marketsUs)) &&
      draft.orderAmountKrw.trim() &&
      (!Number.isFinite(orderKrwNum) || orderKrwNum < 5000)
    ) {
      setErr(ko.app.liveTradeFieldAmountKrwMin);
      return;
    }
    if (draft.marketsUs && !draft.orderAmountUsd.trim()) {
      setErr(usdAmountFieldLabel(draft.marketsUs, draft.marketsCrypto));
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

  const handleArmLane = useCallback(
    async (id: string, lane: LiveTradeArmLane) => {
      setBusy(true);
      setErr(null);
      setMsg(null);
      try {
        const out = await armLiveTradeProgram(id, lane);
        if (lane === "bithumb") {
          if (out.bithumb.ready && out.bithumb.liveOrdersEnabled) {
            setMsg(ko.app.liveTradeArmedOkBithumb);
          } else if (!out.bithumb.configured) {
            setMsg(ko.app.liveTradeArmedWaitBithumbKeys);
          } else {
            setMsg(ko.app.liveTradeArmedWaitBithumb);
          }
        } else {
          setMsg(
            out.toss.ready ? ko.app.liveTradeArmedOk : ko.app.liveTradeArmedWaitToss,
          );
        }
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
  const bithumb = status?.bithumb;

  return (
    <LiveTradeFeeRatesProvider feeRates={status?.feeRates}>
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

      {loadErr && user ? (
        <div className="alert alert--error" role="alert">
          {loadErr}
        </div>
      ) : null}

      {authChecked ? (
        <LiveTradeAuthPanel
          user={user}
          registrationOpen={registrationOpen}
          onAuthChange={() => {
            invalidateLiveTradingPrefetch();
            refreshLiveTradingStatusNow();
            setPortfolioRefreshKey((k) => k + 1);
            void refreshAuth().then((nextUser) => reload(nextUser));
          }}
        />
      ) : null}

      {!user ? (
        <p className="live-trading-tab__hint card">
          {ko.app.liveTradeAuthRequired}
        </p>
      ) : null}

      <div
        className="live-trading-tab__api-row"
        aria-label={ko.app.liveTradeApiRowAria}
      >
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
                {status?.tossSimulatedOrders === false
                  ? ko.app.liveTradeTossOk
                  : ko.app.liveTradeTossSim}
              </span>
            </li>
          </ul>
        </section>

        <section
          className={`live-trading-tab__toss card ${
            bithumb?.ready
              ? "live-trading-tab__toss--ready"
              : bithumb?.configured
                ? "live-trading-tab__toss--partial"
                : "live-trading-tab__toss--off"
          }`}
          aria-live="polite"
        >
          <h3 className="live-trading-tab__section-title">
            {ko.app.liveTradeBithumbTitle}
          </h3>
          <p className="live-trading-tab__toss-msg">{bithumb?.messageKo ?? "—"}</p>
          <ul
            className="live-trading-tab__toss-env"
            aria-label={ko.app.liveTradeBithumbChecklist}
          >
            <li>
              <span>{ko.app.liveTradeBithumbItemKey}</span>
              <span className="live-trading-tab__toss-state">
                {bithumb?.configured ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
              </span>
            </li>
            <li>
              <span>{ko.app.liveTradeBithumbItemSecret}</span>
              <span className="live-trading-tab__toss-state">
                {bithumb?.ready ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
              </span>
            </li>
            <li>
              <span>{ko.app.liveTradeBithumbItemExchangeOrders}</span>
              <span className="live-trading-tab__toss-state">
                {bithumb?.liveOrdersEnabled
                  ? ko.app.liveTradeExchangeOrdersOn
                  : ko.app.liveTradeExchangeOrdersOff}
              </span>
            </li>
          </ul>
          {bithumb?.configured ? (
            <p className="live-trading-tab__hint live-trading-tab__cred-hint">
              {ko.app.liveTradeBithumbProgramSimHint}
            </p>
          ) : null}
          {status?.feeRates?.bithumb?.labelKo ? (
            <p className="live-trading-tab__hint live-trading-tab__fee-hint">
              {ko.app.liveTradeFeeLabel}: {status.feeRates.bithumb.labelKo}
            </p>
          ) : null}
          {user ? (
            <LiveTradeBithumbCredentialForm
              bithumbReady={Boolean(bithumb?.ready)}
              cryptoReady={status?.credentialsCryptoReady !== false}
              onUpdated={() => void reload()}
            />
          ) : null}
        </section>
      </div>

      {user ? (
        <>
          <LiveSimRunningPanel
            programs={programs}
            status={status}
            busy={busy}
            refreshKey={portfolioRefreshKey}
            onStop={(id) => void handleSimStop(id)}
            onDisarm={(id) => void handleDisarm(id)}
            onProgramUpdated={() => void reload()}
            onOpenHoldingChart={onOpenHoldingChart}
          />

          <LiveTradePortfolioPanel
            programs={programs}
            onOpenHoldingChart={onOpenHoldingChart}
          />
        </>
      ) : null}

      {user ? (
      <div className="live-trading-tab__grid">
        <section className="live-trading-tab__form card" aria-label={ko.app.liveTradeFormTitle}>
          <header className="live-trading-tab__form-head">
            <h3 className="live-trading-tab__section-title live-trading-tab__form-title">
              {editingId ? ko.app.liveTradeFormEdit : ko.app.liveTradeFormNew}
            </h3>
          </header>

          {models.length === 0 ? (
            <p className="live-trading-tab__hint live-trading-tab__form-panel">
              {ko.app.liveTradeNoModels}
            </p>
          ) : (
            <div className="live-trading-tab__form-panel">
              {!editingId ? (
                <LiveSimRecommendationsPanel
                  onApplyPatch={(patch: LiveSimDraftPatch) => {
                    setDraft((d) => ({
                      ...d,
                      modelId: patch.modelId ?? d.modelId,
                      marketsKr: patch.marketsKr ?? d.marketsKr,
                      marketsUs: patch.marketsUs ?? d.marketsUs,
                      marketsCrypto: patch.marketsCrypto ?? d.marketsCrypto,
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

              <div className="live-trading-tab__form-grid">
                <label className="live-trading-tab__field live-trading-tab__field--full">
                  <span className="live-trading-tab__label">
                    {ko.app.liveTradeFieldName}
                  </span>
                  <input
                    type="text"
                    className="input live-trading-tab__input"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    placeholder={ko.app.liveTradeNamePlaceholder}
                  />
                </label>

                <label className="live-trading-tab__field live-trading-tab__field--full">
                  <span className="live-trading-tab__label">
                    {ko.app.liveTradeFieldModel}
                  </span>
                  <select
                    className="input live-trading-tab__input"
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

                <div className="live-trading-tab__field live-trading-tab__field--full">
                  <span className="live-trading-tab__label">
                    {ko.app.liveTradeFieldMarkets}
                  </span>
                  <div
                    className="live-trading-tab__segment"
                    role="group"
                    aria-label={ko.app.liveTradeFieldMarkets}
                  >
                    <button
                      type="button"
                      className={
                        draft.marketsKr
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-pressed={draft.marketsKr}
                      onClick={() =>
                        setDraft((d) => ({ ...d, marketsKr: !d.marketsKr }))
                      }
                    >
                      {ko.app.liveTradeMarketKr}
                    </button>
                    <button
                      type="button"
                      className={
                        draft.marketsUs
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-pressed={draft.marketsUs}
                      onClick={() =>
                        setDraft((d) => ({ ...d, marketsUs: !d.marketsUs }))
                      }
                    >
                      {ko.app.liveTradeMarketUs}
                    </button>
                    <button
                      type="button"
                      className={
                        draft.marketsCrypto
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-pressed={draft.marketsCrypto}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          marketsCrypto: !d.marketsCrypto,
                        }))
                      }
                    >
                      {ko.app.liveTradeMarketCrypto}
                    </button>
                  </div>
                  {draft.marketsCrypto ? (
                    <p className="live-trading-tab__hint live-trading-tab__hint--inline">
                      {ko.app.liveTradeCryptoSimNote}
                    </p>
                  ) : null}
                </div>

                <div className="live-trading-tab__field live-trading-tab__field--range">
                  <div className="live-trading-tab__field-top">
                    <span className="live-trading-tab__label">
                      {ko.app.liveTradeFieldMinScore}
                    </span>
                    <span className="live-trading-tab__range-val">
                      {Math.round(draft.minScoreRatio * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    className="live-trading-tab__range"
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
                </div>

                <label className="live-trading-tab__field">
                  <span className="live-trading-tab__label">
                    {ko.app.liveTradeFieldMaxPos}
                  </span>
                  <input
                    type="number"
                    className="input live-trading-tab__input"
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

                <label
                  className={`live-trading-tab__field${!draft.marketsKr && !(draft.marketsCrypto && !draft.marketsUs) ? " live-trading-tab__field--off" : ""}`}
                >
                  <span className="live-trading-tab__label">
                    {krwAmountFieldLabel(draft.marketsKr, draft.marketsCrypto)}
                  </span>
                  <input
                    type="number"
                    className="input live-trading-tab__input"
                    min={5000}
                    step={1000}
                    value={draft.orderAmountKrw}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, orderAmountKrw: e.target.value }))
                    }
                    disabled={!draft.marketsKr && !(draft.marketsCrypto && !draft.marketsUs)}
                  />
                </label>

                <label
                  className={`live-trading-tab__field${!draft.marketsUs ? " live-trading-tab__field--off" : ""}`}
                >
                  <span className="live-trading-tab__label">
                    {usdAmountFieldLabel(
                      draft.marketsUs,
                      draft.marketsCrypto,
                    )}
                  </span>
                  <input
                    type="number"
                    className="input live-trading-tab__input"
                    min={10}
                    step={10}
                    value={draft.orderAmountUsd}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, orderAmountUsd: e.target.value }))
                    }
                    disabled={!draft.marketsUs}
                  />
                </label>
              </div>

              <div className="live-trading-tab__form-toggles">
                <label
                  className={
                    draft.simAutoBuy
                      ? "live-trading-tab__toggle live-trading-tab__toggle--on"
                      : "live-trading-tab__toggle"
                  }
                >
                  <input
                    type="checkbox"
                    className="live-trading-tab__toggle-input"
                    checked={draft.simAutoBuy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, simAutoBuy: e.target.checked }))
                    }
                  />
                  <span>{ko.app.liveTradeFieldSimAutoBuy}</span>
                </label>

                <label
                  className={
                    draft.autoSellAtTarget
                      ? "live-trading-tab__toggle live-trading-tab__toggle--on"
                      : "live-trading-tab__toggle"
                  }
                >
                  <input
                    type="checkbox"
                    className="live-trading-tab__toggle-input"
                    checked={draft.autoSellAtTarget}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        autoSellAtTarget: e.target.checked,
                      }))
                    }
                  />
                  <span>{ko.app.liveTradeFieldAutoSell}</span>
                </label>
              </div>

              {draft.autoSellAtTarget ? (
                <>
                  <label className="live-trading-tab__field">
                    <span className="live-trading-tab__label">
                      {ko.app.liveTradeFieldSellHorizon}
                    </span>
                    <select
                      className="input live-trading-tab__input"
                      value={draft.sellHorizon}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          sellHorizon: e.target.value as "short" | "medium" | "long",
                        }))
                      }
                    >
                      <option value="short">{ko.app.liveTradeSellHorizonShort}</option>
                      <option value="medium">{ko.app.liveTradeSellHorizonMedium}</option>
                      <option value="long">{ko.app.liveTradeSellHorizonLong}</option>
                    </select>
                  </label>
                  <p className="live-trading-tab__form-footnote">
                    {ko.app.liveTradeAutoExitHint}
                  </p>
                </>
              ) : null}

              <div className="live-trading-tab__actions">
                <button
                  type="button"
                  className="btn btn--primary live-trading-tab__submit"
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

              {msg ? (
                <p
                  className="live-trading-tab__banner live-trading-tab__banner--ok"
                  role="status"
                >
                  {msg}
                </p>
              ) : null}
              {err ? (
                <p
                  className="live-trading-tab__banner live-trading-tab__banner--err"
                  role="alert"
                >
                  {err}
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="live-trading-tab__list card" aria-label={ko.app.liveTradeListTitle}>
          <h3 className="live-trading-tab__section-title">
            {ko.app.liveTradeListTitle}
            {programs.length > 0 ? (
              <span className="live-trading-tab__count">{programs.length}</span>
            ) : null}
          </h3>

          <div className="live-trading-tab__list-body">
          {programs.length === 0 ? (
            <p className="live-trading-tab__empty">{ko.app.liveTradeListEmpty}</p>
          ) : (
            <ul className="live-trading-tab__programs">
              {programs.map((p) => {
                const model = modelById.get(p.modelId);
                const ret = status?.programReturns?.[p.id];
                const holdingCount = ret?.holdingCount ?? 0;
                const displayStatus = programDisplayStatus(p, holdingCount);
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
                    className={`live-trading-tab__program live-trading-tab__program--${displayStatus}`}
                  >
                    <div className="live-trading-tab__program-head">
                      <strong>{p.name}</strong>
                      <span
                        className={`live-trading-tab__badge live-trading-tab__badge--${displayStatus}`}
                      >
                        {statusLabel(displayStatus)}
                      </span>
                    </div>
                    <p className="live-trading-tab__program-meta">
                      {ko.app.liveTradeFieldModel}: {model?.name ?? p.modelId}
                    </p>
                    <p className="live-trading-tab__program-meta">
                      {[
                        p.markets.kr ? ko.app.liveTradeMarketKr : "",
                        p.markets.us ? ko.app.liveTradeMarketUs : "",
                        p.markets.crypto ? ko.app.liveTradeMarketCrypto : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {" · "}
                      {ko.app.liveTradeMinScoreShort}: {Math.round(p.minScoreRatio * 100)}%
                    </p>
                    <p className="live-trading-tab__program-meta">
                      {p.markets.kr
                        ? `${krwAmountFieldLabel(p.markets.kr, p.markets.crypto && !p.markets.us)}: ${formatMoney(p.orderAmountKrw, "krw")}`
                        : ""}
                      {p.markets.crypto && !p.markets.us && !p.markets.kr
                        ? `${ko.app.liveTradeFieldAmountCrypto}: ${
                            p.orderAmountKrw != null
                              ? formatMoney(p.orderAmountKrw, "krw")
                              : p.orderAmountUsd != null
                                ? formatMoney(p.orderAmountUsd, "usd")
                                : "—"
                          }`
                        : ""}
                      {p.markets.us
                        ? `${p.markets.kr ? " · " : ""}${usdAmountFieldLabel(p.markets.us, p.markets.crypto)}: ${
                            formatMoney(p.orderAmountUsd, "usd")
                          }`
                        : ""}
                    </p>
                    <p className="live-trading-tab__program-meta live-trading-tab__program-return">
                      {ko.app.liveTradeCurrentReturn}:{" "}
                      <span className={returnClass}>
                        {formatPercent(returnPct ?? undefined)}
                      </span>
                    </p>
                    {showProgramRunError(p, holdingCount) ? (
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
                        <>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={busy}
                            onClick={() => void handleDisarm(p.id)}
                          >
                            {ko.app.liveTradeDisarm}
                          </button>
                          {showArmLaneButton(p, "bithumb") ? (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={busy}
                              onClick={() => void handleArmLane(p.id, "bithumb")}
                            >
                              {ko.app.liveTradeArmBithumb}
                            </button>
                          ) : null}
                          {showArmLaneButton(p, "toss") ? (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={busy}
                              onClick={() => void handleArmLane(p.id, "toss")}
                            >
                              {ko.app.liveTradeArmToss}
                            </button>
                          ) : null}
                        </>
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
                          {showArmLaneButton(p, "bithumb") ? (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={busy}
                              onClick={() => void handleArmLane(p.id, "bithumb")}
                            >
                              {ko.app.liveTradeArmBithumb}
                            </button>
                          ) : null}
                          {showArmLaneButton(p, "toss") ? (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={busy}
                              onClick={() => void handleArmLane(p.id, "toss")}
                            >
                              {ko.app.liveTradeArmToss}
                            </button>
                          ) : null}
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
          </div>
        </section>
      </div>
      ) : null}
    </div>
    </LiveTradeFeeRatesProvider>
  );
}
