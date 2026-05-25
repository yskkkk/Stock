import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser, LiveTradeHolding } from "../api";
import {
  armLiveTradeProgram,
  createLiveTradeProgram,
  deleteLiveTradeProgram,
  disarmLiveTradeProgram,
  startSimLiveTradeProgram,
  stopSimLiveTradeProgram,
  fetchAccessAdminLiveTradingUserStatus,
  fetchLiveTradingStatus,
  fetchTechModels,
  getStoredAccessAdminToken,
  updateLiveTradeProgram,
  type LiveTradeArmLane,
  type LiveTradeProgram,
  type LiveTradingStatusResponse,
  type TechModelRecord,
} from "../api";
import LiveSimRunningPanel from "./LiveSimRunningPanel";
import LiveTradeAdminServerRunning from "./LiveTradeAdminServerRunning";
import LiveTradeRegisteredProgramCard from "./LiveTradeRegisteredProgramCard";
import LiveSimRecommendationsPanel, {
  type LiveSimDraftPatch,
} from "./LiveSimRecommendationsPanel";
import LiveTradePortfolioPanel from "./LiveTradePortfolioPanel";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import {
  refreshLiveTradingStatusNow,
  useLiveTradingStatusPoll,
} from "../hooks/useLiveTradingStatusPoll";
import { LIVE_TRADE_DOCK_OPEN_FORM_EVENT } from "../lib/liveTradeDockEvents";
import { invalidateLiveTradingPrefetch, peekLiveTradingPrefetch } from "../lib/tabPrefetch";
import { formatPercent } from "../lib/format";
import LiveTradeAuthPanel, {
  LiveTradeCardSidePanelInline,
  LiveTradeCollapsibleCard,
  notifyLiveTradeAuthChange,
  useLiveTradeAuth,
  useLiveTradeCardSidePanel,
  useLiveTradeCardSidePanelOptional,
} from "./LiveTradeAuthAndCredentials";
import {
  programDisplayStatus,
  showProgramRunError,
} from "../lib/liveProgramDisplay";
import { ko } from "../i18n/ko";
import { LiveTradeFeeRatesProvider } from "../contexts/LiveTradeFeeRatesContext";
import {
  isOrderAmountKrwValid,
  minOrderAmountKrwForMarkets,
} from "../constants/liveTradeOrder";

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

function krwAmountFieldLabel(crypto: boolean): string {
  if (crypto) return ko.app.liveTradeFieldAmountCrypto;
  return ko.app.liveTradeFieldAmountKrw;
}

type LiveTradeMarketChoice = "kr" | "us" | "crypto";

function draftMarketChoice(d: {
  marketsKr: boolean;
  marketsUs: boolean;
  marketsCrypto: boolean;
}): LiveTradeMarketChoice {
  if (d.marketsUs) return "us";
  if (d.marketsCrypto) return "crypto";
  return "kr";
}

function marketsFromChoice(c: LiveTradeMarketChoice): {
  marketsKr: boolean;
  marketsUs: boolean;
  marketsCrypto: boolean;
} {
  return {
    marketsKr: c === "kr",
    marketsUs: c === "us",
    marketsCrypto: c === "crypto",
  };
}

function marketsFromProgram(m: {
  kr: boolean;
  us: boolean;
  crypto: boolean;
}): ReturnType<typeof marketsFromChoice> {
  if (m.us) return marketsFromChoice("us");
  if (m.crypto) return marketsFromChoice("crypto");
  return marketsFromChoice("kr");
}

const emptyDraft = () => ({
  name: "",
  modelId: "",
  marketsKr: true,
  marketsUs: false,
  marketsCrypto: false,
  minScoreRatio: 0.8,
  maxOpenPositions: "5",
  orderAmountKrw: "10000",
  orderAmountUsd: "",
  simAutoBuy: true,
  autoSellAtTarget: true,
  sellHorizon: "short" as "short" | "medium" | "long",
});

function LiveTradeCardWorkspace({
  editingId,
  onCloseEdit,
  children,
}: {
  editingId: string | null;
  onCloseEdit: () => void;
  children: ReactNode;
}) {
  const { panel, closePanel } = useLiveTradeCardSidePanel();

  useMobileBackHandler(
    Boolean(panel),
    MOBILE_BACK_PRIORITY.LIVE_TRADE_CARD_PANEL,
    () => {
      if (panel?.id === "form" && editingId) onCloseEdit();
      else closePanel();
    },
  );

  return (
    <div
      className={`live-trading-tab__card-workspace${
        panel ? " live-trading-tab__card-workspace--tab-active" : ""
      }`}
    >
      {children}
    </div>
  );
}

export type LiveTradeAdminViewState = {
  userId: string;
  label: string;
  programId?: string;
  programName?: string;
};

export default function LiveTradingTab({
  onOpenRecommendations,
  onOpenHoldingChart,
  /** 데스크톱 도크 포털 전용(카드 본문만 DOM 유지) */
  portalSourceOnly = false,
  /** 실매매 탭 본문 — 카드 행은 도크 포털 인스턴스에만 */
  hideCardDock = false,
  adminView = null,
  onClearAdminView,
  canAdminLiveTrade = false,
  adminIpBypass = false,
  onAdminViewUser,
}: {
  onOpenRecommendations?: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
  portalSourceOnly?: boolean;
  hideCardDock?: boolean;
  adminView?: LiveTradeAdminViewState | null;
  onClearAdminView?: () => void;
  canAdminLiveTrade?: boolean;
  adminIpBypass?: boolean;
  onAdminViewUser?: (p: {
    userId: string;
    programId: string;
    name: string;
  }) => void;
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
  const sidePanel = useLiveTradeCardSidePanelOptional();
  const polledStatus = useLiveTradingStatusPoll();
  const adminViewUserId = adminView?.userId?.trim() || null;
  const adminReadOnly = Boolean(
    adminViewUserId && user?.id && user.id !== adminViewUserId,
  );

  const reload = useCallback(async (userOverride?: AuthUser | null) => {
    const activeUser = userOverride !== undefined ? userOverride : user;
    if (!activeUser) {
      setStatus(null);
      return;
    }
    try {
      const tm = await fetchTechModels();
      setModels(tm.models);
      if (adminViewUserId && activeUser.id !== adminViewUserId) {
        const token = getStoredAccessAdminToken() ?? "";
        if (!token.trim() && !adminIpBypass) {
          throw new Error(ko.access.adminPasswordLabel);
        }
        const [baseSt, adminSt] = await Promise.all([
          fetchLiveTradingStatus(),
          fetchAccessAdminLiveTradingUserStatus(token, adminViewUserId),
        ]);
        setStatus({
          ...baseSt,
          programs: adminSt.programs,
          programReturns: adminSt.programReturns,
          armedCount: adminSt.armedCount,
          simCount: adminSt.simCount,
        });
      } else {
        const st = await fetchLiveTradingStatus();
        setStatus(st);
      }
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
  }, [user, adminViewUserId, adminIpBypass]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload, adminViewUserId]);

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

  const programs = status?.programs ?? [];
  const simPrograms = adminReadOnly
    ? programs
    : hideCardDock && polledStatus?.programs
      ? polledStatus.programs
      : programs;

  const portfolioAdminView = useMemo(
    () =>
      adminReadOnly && adminViewUserId
        ? {
            userId: adminViewUserId,
            programId: adminView?.programId,
            programName: adminView?.programName,
          }
        : null,
    [
      adminReadOnly,
      adminViewUserId,
      adminView?.programId,
      adminView?.programName,
    ],
  );

  const draftMarkets = useMemo(
    () => ({
      kr: draft.marketsKr,
      us: draft.marketsUs,
      crypto: draft.marketsCrypto,
    }),
    [draft.marketsKr, draft.marketsUs, draft.marketsCrypto],
  );

  const marketChoice = draftMarketChoice(draft);
  const needsKrwAmount = marketChoice === "kr" || marketChoice === "crypto";
  const needsUsdAmount = marketChoice === "us";
  const minOrderKrw = minOrderAmountKrwForMarkets(draftMarkets);
  const canSaveForm =
    Boolean(draft.name.trim() && draft.modelId) &&
    parseMaxOpenPositionsInput(draft.maxOpenPositions) != null &&
    (!needsKrwAmount || draft.orderAmountKrw.trim() !== "") &&
    (!needsUsdAmount || draft.orderAmountUsd.trim() !== "");

  const formCardSummary = useMemo(() => {
    if (editingId) {
      const p = programs.find((x) => x.id === editingId);
      return p
        ? `${p.name} · ${ko.app.liveTradeFormEdit}`
        : ko.app.liveTradeFormEdit;
    }
    const markets = [
      draft.marketsKr ? ko.app.liveTradeMarketKr : "",
      draft.marketsUs ? ko.app.liveTradeMarketUs : "",
      draft.marketsCrypto ? ko.app.liveTradeMarketCrypto : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const label = draft.name.trim() || ko.app.liveTradeNamePlaceholder;
    return `${label} · ${markets || "—"} · ${Math.round(draft.minScoreRatio * 100)}%`;
  }, [draft, editingId, programs]);

  const programsListSummary = useMemo(() => {
    if (programs.length === 0) return ko.app.liveTradeListEmpty;
    const running = programs
      .map((p) => {
        const hc = status?.programReturns?.[p.id]?.holdingCount ?? 0;
        const st = programDisplayStatus(p, hc);
        if (st === "armed" || st === "sim") {
          return `${p.name} ${statusLabel(st)}`;
        }
        return null;
      })
      .filter(Boolean);
    if (running.length > 0) {
      const head = running.slice(0, 2).join(" · ");
      const more = running.length > 2 ? ` · +${running.length - 2}` : "";
      return `${programs.length}개 · ${head}${more}`;
    }
    return `${programs.length}개`;
  }, [programs, status?.programReturns]);

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

  const loadProgramToForm = useCallback(
    (p: LiveTradeProgram) => {
      setEditingId(p.id);
      setDraft({
        name: p.name,
        modelId: p.modelId,
        ...marketsFromProgram(p.markets),
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
      sidePanel?.openPanel("form", ko.app.liveTradeFormEdit);
    },
    [sidePanel],
  );

  useEffect(() => {
    const onDockNewForm = () => {
      resetForm();
    };
    window.addEventListener(LIVE_TRADE_DOCK_OPEN_FORM_EVENT, onDockNewForm);
    return () =>
      window.removeEventListener(LIVE_TRADE_DOCK_OPEN_FORM_EVENT, onDockNewForm);
  }, [resetForm]);

  const buildBody = useCallback(() => {
    const orderKrw = draft.orderAmountKrw.trim();
    const orderUsd = draft.orderAmountUsd.trim();
    const maxOpenPositions = parseMaxOpenPositionsInput(draft.maxOpenPositions)!;
    const choice = draftMarketChoice(draft);
    const bodyNeedsKrw = choice === "kr" || choice === "crypto";
    const bodyNeedsUsd = choice === "us";
    return {
      name: draft.name.trim(),
      modelId: draft.modelId,
      markets: {
        kr: choice === "kr",
        us: choice === "us",
        crypto: choice === "crypto",
      },
      minScoreRatio: draft.minScoreRatio,
      maxOpenPositions,
      orderAmountKrw: bodyNeedsKrw && orderKrw ? Number(orderKrw) : null,
      orderAmountUsd: bodyNeedsUsd && orderUsd ? Number(orderUsd) : null,
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
    const choice = draftMarketChoice(draft);
    const saveNeedsKrw = choice === "kr" || choice === "crypto";
    const saveNeedsUsd = choice === "us";
    if (
      saveNeedsKrw &&
      !draft.orderAmountKrw.trim()
    ) {
      setErr(krwAmountFieldLabel(choice === "crypto"));
      return;
    }
    const orderKrwNum = Number(draft.orderAmountKrw.trim());
    const minOrderKrw = minOrderAmountKrwForMarkets({
      kr: choice === "kr",
      us: false,
      crypto: choice === "crypto",
    });
    if (
      saveNeedsKrw &&
      draft.orderAmountKrw.trim() &&
      (!Number.isFinite(orderKrwNum) || orderKrwNum < minOrderKrw)
    ) {
      setErr(
        choice === "crypto"
          ? `코인 1회 매수 금액은 ${minOrderKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`
          : `1회 매수 금액은 ${minOrderKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`,
      );
      return;
    }
    if (saveNeedsUsd && !draft.orderAmountUsd.trim()) {
      setErr(usdAmountFieldLabel(false, false));
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
    async (id: string, name: string) => {
      const target = status?.programs.find((p) => p.id === id);
      const running = target?.status === "sim" || target?.status === "armed";
      const confirmMsg = running
        ? ko.app.liveTradeDeleteRunningConfirm.replace("{name}", name)
        : ko.app.liveTradeDeleteConfirmNamed.replace("{name}", name);
      if (!window.confirm(confirmMsg)) return;
      setBusy(true);
      setErr(null);
      try {
        if (target?.status === "sim") {
          await stopSimLiveTradeProgram(id);
        } else if (target?.status === "armed") {
          await disarmLiveTradeProgram(id);
        }
        const res = await deleteLiveTradeProgram(id);
        if (editingId === id) resetForm();
        setStatus((prev) => {
          if (!prev) return prev;
          const programs = res.programs;
          return {
            ...prev,
            programs,
            armedCount: programs.filter((p) => p.status === "armed").length,
            simCount: programs.filter((p) => p.status === "sim").length,
          };
        });
        invalidateLiveTradingPrefetch();
        refreshLiveTradingStatusNow();
        setPortfolioRefreshKey((k) => k + 1);
        void reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [editingId, reload, resetForm, status?.programs],
  );

  const handleArmLane = useCallback(
    async (id: string, lane: LiveTradeArmLane) => {
      setBusy(true);
      setErr(null);
      setMsg(null);
      try {
        const out = await armLiveTradeProgram(id, lane);
        if (lane === "bithumb") {
          if (out.bithumb.ready) {
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

  const showCardDock = portalSourceOnly || !hideCardDock;

  return (
    <LiveTradeFeeRatesProvider feeRates={status?.feeRates}>
    <div
      className={
        portalSourceOnly
          ? "live-trading-tab live-trading-panel live-trading-panel--dock-portals"
          : "live-trading-tab live-trading-panel"
      }
    >
      {!portalSourceOnly ? (
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
      ) : null}

      {!portalSourceOnly && loadErr && user ? (
        <div className="alert alert--error" role="alert">
          {loadErr}
        </div>
      ) : null}

      {!portalSourceOnly && authChecked ? (
        <LiveTradeAuthPanel
          user={user}
          registrationOpen={registrationOpen}
          onAuthChange={() => {
            invalidateLiveTradingPrefetch();
            refreshLiveTradingStatusNow();
            setPortfolioRefreshKey((k) => k + 1);
            notifyLiveTradeAuthChange();
            void refreshAuth().then((nextUser) => reload(nextUser));
          }}
        />
      ) : null}

      {user ? (
        <>
          {!portalSourceOnly && adminReadOnly ? (
            <div className="live-trading-tab__admin-banner card" role="status">
              <p>
                {ko.access.liveTradeAdminViewBanner.replace(
                  "{user}",
                  adminView?.label ?? adminViewUserId ?? "",
                )}
              </p>
              {onClearAdminView ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={onClearAdminView}
                >
                  {ko.access.liveTradeAdminViewExit}
                </button>
              ) : null}
            </div>
          ) : null}
          {!portalSourceOnly && canAdminLiveTrade && !adminReadOnly ? (
            <LiveTradeAdminServerRunning
              enabled
              adminIpBypass={adminIpBypass}
              onViewUser={(p) => onAdminViewUser?.(p)}
            />
          ) : null}
          {!portalSourceOnly ? (
          <LiveSimRunningPanel
            programs={simPrograms}
            busy={busy}
            refreshKey={portfolioRefreshKey}
            adminViewUserId={adminReadOnly ? adminViewUserId : null}
            readOnly={adminReadOnly}
            onStop={(id) => void handleSimStop(id)}
            onDisarm={(id) => void handleDisarm(id)}
            onProgramUpdated={() => void reload()}
            onOpenHoldingChart={onOpenHoldingChart}
          />
          ) : null}

          {showCardDock ? (
            <div className="live-trading-tab__card-dock">
            <LiveTradeCardWorkspace
              editingId={editingId}
              onCloseEdit={resetForm}
            >
              <div className="live-trading-tab__card-row">
                <LiveTradePortfolioPanel
                  programs={programs}
                  onOpenHoldingChart={onOpenHoldingChart}
                  initialAdminView={portfolioAdminView}
                />
                {!adminReadOnly ? (
                <LiveTradeCollapsibleCard
          key={editingId ? `edit-${editingId}` : "new-form"}
          title={editingId ? ko.app.liveTradeFormEdit : ko.app.liveTradeFormNew}
          summary={formCardSummary}
          defaultOpen={Boolean(editingId)}
          className="live-trading-tab__form"
          ariaLabel={ko.app.liveTradeFormTitle}
          sidePanelId="form"
        >
          {models.length === 0 ? (
            <p className="live-trading-tab__hint live-trading-tab__form-panel">
              {ko.app.liveTradeNoModels}
            </p>
          ) : (
            <div className="live-trading-tab__form-panel">
              {!editingId ? (
                <LiveSimRecommendationsPanel
                  onApplyPatch={(patch: LiveSimDraftPatch) => {
                    const patchMarkets =
                      patch.marketsUs === true
                        ? marketsFromChoice("us")
                        : patch.marketsCrypto === true
                          ? marketsFromChoice("crypto")
                          : patch.marketsKr === true
                            ? marketsFromChoice("kr")
                            : null;
                    setDraft((d) => ({
                      ...d,
                      modelId: patch.modelId ?? d.modelId,
                      ...(patchMarkets ?? {}),
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
                    role="radiogroup"
                    aria-label={ko.app.liveTradeFieldMarkets}
                  >
                    <button
                      type="button"
                      role="radio"
                      className={
                        marketChoice === "kr"
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-checked={marketChoice === "kr"}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          ...marketsFromChoice("kr"),
                        }))
                      }
                    >
                      {ko.app.liveTradeMarketKr}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      className={
                        marketChoice === "us"
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-checked={marketChoice === "us"}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          ...marketsFromChoice("us"),
                        }))
                      }
                    >
                      {ko.app.liveTradeMarketUs}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      className={
                        marketChoice === "crypto"
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-checked={marketChoice === "crypto"}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          ...marketsFromChoice("crypto"),
                        }))
                      }
                    >
                      {ko.app.liveTradeMarketCrypto}
                    </button>
                  </div>
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
                  className={`live-trading-tab__field${!needsKrwAmount ? " live-trading-tab__field--off" : ""}`}
                >
                  <span className="live-trading-tab__label">
                    {krwAmountFieldLabel(marketChoice === "crypto")}
                  </span>
                  <input
                    type="number"
                    className="input live-trading-tab__input"
                    step={1000}
                    value={draft.orderAmountKrw}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        orderAmountKrw: e.target.value,
                      }))
                    }
                    disabled={!needsKrwAmount}
                  />
                  {needsKrwAmount &&
                  draft.orderAmountKrw.trim() &&
                  !isOrderAmountKrwValid(draft.orderAmountKrw, draftMarkets) ? (
                    <span className="live-trading-tab__hint live-trading-tab__hint--inline live-trading-tab__hint--warn">
                      {marketChoice === "crypto"
                        ? `코인 1회 매수 금액은 ${minOrderKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`
                        : `1회 매수 금액은 ${minOrderKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`}
                    </span>
                  ) : needsKrwAmount ? (
                    <span className="live-trading-tab__hint live-trading-tab__hint--inline">
                      {ko.app.liveTradeFieldAmountKrwMin.replace(
                        "{n}",
                        minOrderKrw.toLocaleString("ko-KR"),
                      )}
                    </span>
                  ) : null}
                </label>

                <label
                  className={`live-trading-tab__field${!needsUsdAmount ? " live-trading-tab__field--off" : ""}`}
                >
                  <span className="live-trading-tab__label">
                    {usdAmountFieldLabel(false, false)}
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
                    disabled={!needsUsdAmount}
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
                  disabled={busy || !canSaveForm}
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
        </LiveTradeCollapsibleCard>
                ) : null}

        <LiveTradeCollapsibleCard
          title={ko.app.liveTradeListTitle}
          summary={programsListSummary}
          className="live-trading-tab__list"
          ariaLabel={ko.app.liveTradeListTitle}
          sidePanelId="programs"
        >
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
                return (
                  <li key={p.id}>
                    <LiveTradeRegisteredProgramCard
                      program={p}
                      model={model}
                      displayStatus={displayStatus}
                      returnPct={returnPct}
                      holdingCount={holdingCount}
                      busy={busy}
                      showArmLaneButton={(lane) => showArmLaneButton(p, lane)}
                      onSimStop={() => void handleSimStop(p.id)}
                      onDisarm={() => void handleDisarm(p.id)}
                      onSimStart={() => void handleSimStart(p.id)}
                      onArmLane={(lane) => void handleArmLane(p.id, lane)}
                      onEdit={() => loadProgramToForm(p)}
                      onDelete={() => void handleDelete(p.id, p.name)}
                      readOnly={adminReadOnly}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </LiveTradeCollapsibleCard>
              </div>
            </LiveTradeCardWorkspace>
            {!portalSourceOnly ? <LiveTradeCardSidePanelInline /> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
    </LiveTradeFeeRatesProvider>
  );
}
