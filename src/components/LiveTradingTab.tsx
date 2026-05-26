import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser, LiveTradeHolding } from "../api";
import { BOX_RANGE_MODEL_ID } from "../lib/boxRangeTechModel";
import {
  armLiveTradeProgram,
  createLiveTradeProgram,
  deleteLiveTradeProgram,
  disarmLiveTradeProgram,
  startSimLiveTradeProgram,
  stopSimLiveTradeProgram,
  fetchAccessAdminLiveTradingUserStatus,
  fetchLiveTradingStatus,
  fetchLiveTradingBoxRangeStatus,
  fetchLiveTradeTechModels,
  type LiveTradeBoxRangeStatusResponse,
  getStoredAccessAdminToken,
  updateLiveTradeProgram,
  type LiveTradeArmLane,
  type LiveTradeProgram,
  type LiveTradingStatusResponse,
  type TechModelRecord,
} from "../api";
import LiveSimRunningPanel from "./LiveSimRunningPanel";
import LiveTradeHistorySimSection from "./LiveTradeHistorySimSection";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import LiveTradeHistoryScenarioTabs from "./LiveTradeHistoryScenarioTabs";
import type { LiveTradeHistoryScenario } from "../lib/liveTradeHistoryScenario";
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
import {
  LIVE_TRADE_DOCK_OPEN_FORM_EVENT,
  dispatchLiveTradeDockAfterFormSave,
} from "../lib/liveTradeDockEvents";
import { openAccountTrades } from "../lib/liveTradeDockAccount";
import {
  LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT,
  type LiveTradePortfolioPanelTab,
} from "../lib/liveTradePortfolioFocus";
import { invalidateLiveTradingPrefetch, peekLiveTradingPrefetch } from "../lib/tabPrefetch";
import { formatPercent } from "../lib/format";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import LiveTradeAuthPanel, {
  defaultLiveTradeSideTabTitles,
  LiveTradeCardSidePanelInline,
  LiveTradeCollapsibleCard,
  LiveTradeSidePanelPortal,
  notifyLiveTradeAuthChange,
  useLiveTradeAuth,
  useLiveTradeCardSidePanel,
  useLiveTradeCardSidePanelOptional,
} from "./LiveTradeAuthAndCredentials";

const LIVE_TRADE_ACTIVITY_PANEL_ID = "activity";
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
import {
  liveTradeProgramDraftCanSave,
  parseMaxOpenPositionsInput,
  validateLiveTradeProgramDraft,
} from "../lib/liveTradeProgramFormValidate";

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

function usdAmountFieldLabel(marketsUs: boolean, marketsCrypto: boolean): string {
  if (marketsUs && marketsCrypto) return ko.app.liveTradeFieldAmountUsdCrypto;
  return ko.app.liveTradeFieldAmountUsd;
}

function krwAmountFieldLabel(crypto: boolean): string {
  if (crypto) return ko.app.liveTradeFieldAmountCrypto;
  return ko.app.liveTradeFieldAmountKrw;
}

function marketsFromProgram(m: {
  kr: boolean;
  us: boolean;
  crypto: boolean;
}) {
  return {
    marketsKr: Boolean(m.kr),
    marketsUs: Boolean(m.us),
    marketsCrypto: Boolean(m.crypto),
  };
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
  adminIpBypass = false,
}: {
  onOpenRecommendations?: () => void;
  onOpenHoldingChart?: (h: LiveTradeHolding) => void;
  portalSourceOnly?: boolean;
  hideCardDock?: boolean;
  adminView?: LiveTradeAdminViewState | null;
  onClearAdminView?: () => void;
  adminIpBypass?: boolean;
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
  const saveInFlightRef = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  useEffect(() => {
    if (draft.modelId !== BOX_RANGE_MODEL_ID) return;
    setDraft((d) => {
      if (d.modelId !== BOX_RANGE_MODEL_ID) return d;
      if (d.autoSellAtTarget === false) return d;
      return { ...d, autoSellAtTarget: false };
    });
  }, [draft.modelId]);
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0);
  const [programsPanelTab, setProgramsPanelTab] = useState<
    "programs" | "trades"
  >("programs");
  const [tradeHistoryScenario, setTradeHistoryScenario] =
    useState<LiveTradeHistoryScenario>("sim");
  const [boxRangeStatus, setBoxRangeStatus] =
    useState<LiveTradeBoxRangeStatusResponse | null>(null);
  const sidePanel = useLiveTradeCardSidePanelOptional();
  const polledStatus = useLiveTradingStatusPoll();
  const adminViewUserId = adminView?.userId?.trim() || null;
  const dockSelfOnly = portalSourceOnly;
  const adminReadOnly = Boolean(
    !dockSelfOnly &&
      adminViewUserId &&
      user?.id &&
      user.id !== adminViewUserId,
  );

  useEffect(() => {
    if (!portalSourceOnly || !sidePanel?.openPanel) return;
    const titles = defaultLiveTradeSideTabTitles();
    const onPanelTab = (e: Event) => {
      const tab = (e as CustomEvent<LiveTradePortfolioPanelTab>).detail;
      if (tab === "trade") {
        sidePanel.openPanel(
          "portfolio",
          titles.portfolio ?? ko.app.liveTradePfTitle,
        );
      }
    };
    window.addEventListener(LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT, onPanelTab);
    return () => {
      window.removeEventListener(LIVE_TRADE_PORTFOLIO_PANEL_TAB_EVENT, onPanelTab);
    };
  }, [portalSourceOnly, sidePanel]);

  useEffect(() => {
    if (!portalSourceOnly) return;
    const reg = sidePanel?.registerSideTab;
    if (!reg) return;
    return reg("activity", ko.app.liveTradeActivityTitle);
  }, [portalSourceOnly, sidePanel?.registerSideTab]);

  const reload = useCallback(async (userOverride?: AuthUser | null) => {
    const activeUser = userOverride !== undefined ? userOverride : user;
    if (!activeUser) {
      setStatus(null);
      return;
    }
    try {
      const tm = await fetchLiveTradeTechModels();
      const merged = tm.models;
      setModels(merged);
      if (
        !dockSelfOnly &&
        adminViewUserId &&
        activeUser.id !== adminViewUserId
      ) {
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
          d.modelId && merged.some((m) => m.id === d.modelId)
            ? d.modelId
            : merged[0]?.id ?? "",
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadErr(msg);
      if (msg.includes("로그인")) setStatus(null);
    }
  }, [user, adminViewUserId, adminIpBypass, dockSelfOnly]);

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

  /** 헤더·도크 레일과 동일 — 전역 폴링·탭 reload 중 더 많은 programs 쪽 우선 */
  const effectiveStatus: LiveTradingStatusResponse | null = useMemo(() => {
    if (!polledStatus) return status;
    if (!status) return polledStatus;
    const pn = polledStatus.programs?.length ?? 0;
    const ln = status.programs?.length ?? 0;
    return ln >= pn ? status : polledStatus;
  }, [polledStatus, status]);
  const programs = effectiveStatus?.programs ?? [];
  const loadBoxRangeStatus = useCallback(async () => {
    if (!user || portalSourceOnly) {
      setBoxRangeStatus(null);
      return;
    }
    try {
      setBoxRangeStatus(await fetchLiveTradingBoxRangeStatus());
    } catch {
      setBoxRangeStatus(null);
    }
  }, [user, portalSourceOnly]);

  useEffect(() => {
    void loadBoxRangeStatus();
  }, [
    loadBoxRangeStatus,
    portfolioRefreshKey,
    effectiveStatus?.armedCount,
    effectiveStatus?.simCount,
  ]);

  const activeRunCount =
    (effectiveStatus?.simCount ?? 0) + (effectiveStatus?.armedCount ?? 0);
  /** 메인 실매매 탭 — 도크 미사용 시 또는 가동 중일 때 */
  const showRunningPanelInline =
    !portalSourceOnly && (!hideCardDock || activeRunCount > 0);
  const showRunningPanelInDock =
    portalSourceOnly && sidePanel?.panel?.id === LIVE_TRADE_ACTIVITY_PANEL_ID;

  const portfolioAdminView = useMemo(
    () =>
      !dockSelfOnly && adminReadOnly && adminViewUserId
        ? {
            userId: adminViewUserId,
            programId: adminView?.programId,
            programName: adminView?.programName,
          }
        : null,
    [
      dockSelfOnly,
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

  const isBoxRangeDraft = draft.modelId === BOX_RANGE_MODEL_ID;
  const needsKrwAmount = draft.marketsKr || draft.marketsCrypto;
  const needsUsdAmount = draft.marketsUs;
  const minScoreSliderValue = Math.min(
    1,
    Math.max(0.7, Number(draft.minScoreRatio) || 0.8),
  );
  const minOrderKrw = minOrderAmountKrwForMarkets(draftMarkets);
  const draftValidateContext = useMemo(
    () => ({
      existingPrograms: programs.map((p) => ({ id: p.id, name: p.name })),
      editingProgramId: editingId,
    }),
    [programs, editingId],
  );
  const canSaveForm = liveTradeProgramDraftCanSave(draft, draftValidateContext);
  const saveBlockedHint = useMemo(() => {
    if (canSaveForm) return null;
    const v = validateLiveTradeProgramDraft(draft, draftValidateContext);
    return v.ok ? null : v.message;
  }, [canSaveForm, draft, draftValidateContext]);

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
        const hc = effectiveStatus?.programReturns?.[p.id]?.holdingCount ?? 0;
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
  }, [programs, effectiveStatus?.programReturns]);

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
      sidePanel?.openPanel("form", ko.app.liveTradeFormNew);
    };
    window.addEventListener(LIVE_TRADE_DOCK_OPEN_FORM_EVENT, onDockNewForm);
    return () =>
      window.removeEventListener(LIVE_TRADE_DOCK_OPEN_FORM_EVENT, onDockNewForm);
  }, [resetForm, sidePanel]);

  const handleSave = useCallback(async () => {
    if (busy || saveInFlightRef.current) return;
    setErr(null);
    setMsg(null);
    const checked = validateLiveTradeProgramDraft(draft, draftValidateContext);
    if (!checked.ok) {
      setErr(checked.message);
      sidePanel?.openPanel("form", editingId ? ko.app.liveTradeFormEdit : ko.app.liveTradeFormNew);
      return;
    }
    saveInFlightRef.current = true;
    setBusy(true);
    try {
      const orderKrw = draft.orderAmountKrw.trim();
      const orderUsd = draft.orderAmountUsd.trim();
      const body = {
        name: draft.name.trim(),
        modelId: draft.modelId,
        markets: checked.markets,
        minScoreRatio: draft.minScoreRatio,
        maxOpenPositions: checked.maxOpenPositions,
        orderAmountKrw:
          (checked.markets.kr || checked.markets.crypto) && orderKrw
            ? Number(orderKrw)
            : null,
        orderAmountUsd:
          checked.markets.us && orderUsd ? Number(orderUsd) : null,
        simAutoBuy: draft.simAutoBuy,
        autoSellAtTarget:
          draft.modelId === BOX_RANGE_MODEL_ID ? false : draft.autoSellAtTarget,
        sellHorizon: draft.sellHorizon,
      };
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
      sidePanel?.openPanel("form", editingId ? ko.app.liveTradeFormEdit : ko.app.liveTradeFormNew);
    } finally {
      saveInFlightRef.current = false;
      setBusy(false);
      dispatchLiveTradeDockAfterFormSave();
    }
  }, [busy, draft, draftValidateContext, editingId, reload, resetForm, sidePanel]);

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
  /** 실매매 탭 본문 — 로그인 시 등록 프로그램 전체 목록(도크 사용 중에도 표시) */
  const showMainProgramsList = Boolean(user && !portalSourceOnly);
  const statusPending = Boolean(
    user && authChecked && effectiveStatus == null && !loadErr,
  );

  /** 도크 «프로그램» — 거래내역 서브탭 없음(상단 «거래내역» 탭·보유·거래 레일 사용) */
  const showProgramsTradesSubTab = !portalSourceOnly;

  const programsListContent = (
    <>
      {!effectiveStatus && user ? (
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      ) : (
        <>
          {showProgramsTradesSubTab ? (
            <div
              className="live-trading-tab__list-segment"
              role="tablist"
              aria-label={ko.app.liveTradeListTitle}
            >
              <button
                type="button"
                role="tab"
                className={
                  programsPanelTab === "programs"
                    ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                    : "live-trading-tab__segment-btn"
                }
                aria-selected={programsPanelTab === "programs"}
                onClick={() => setProgramsPanelTab("programs")}
              >
                {ko.app.liveTradeProgramsTabPrograms}
              </button>
              <button
                type="button"
                role="tab"
                className={
                  programsPanelTab === "trades"
                    ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                    : "live-trading-tab__segment-btn"
                }
                aria-selected={programsPanelTab === "trades"}
                onClick={() => {
                  setProgramsPanelTab("trades");
                  if (hideCardDock) {
                    openAccountTrades();
                  }
                }}
              >
                {ko.app.liveTradeProgramsTabTrades}
              </button>
            </div>
          ) : null}
          {showProgramsTradesSubTab && programsPanelTab === "trades" ? (
            hideCardDock ? (
              <p className="live-trading-tab__hint">
                {ko.app.liveTradePfTradesDockHint}
              </p>
            ) : (
              <>
                <LiveTradeHistoryScenarioTabs
                  value={tradeHistoryScenario}
                  onChange={setTradeHistoryScenario}
                  className="live-trading-tab__programs-trade-scenario"
                />
                {tradeHistoryScenario === "sim" ? (
                  <LiveTradeHistorySimSection
                    embedded
                    loadAll
                    adminViewUserId={adminReadOnly ? adminViewUserId : null}
                    programs={programs}
                    programReturns={effectiveStatus?.programReturns}
                  />
                ) : (
                  <LiveTradeTradesHistoryPanel
                    embedded
                    scenario={tradeHistoryScenario}
                    loadAll
                    adminViewUserId={adminReadOnly ? adminViewUserId : null}
                  />
                )}
              </>
            )
          ) : programs.length === 0 ? (
            <p className="live-trading-tab__empty">{ko.app.liveTradeListEmpty}</p>
          ) : (
            <ul className="live-trading-tab__programs">
              {programs.map((p) => {
                const model = modelById.get(p.modelId);
                const ret = effectiveStatus?.programReturns?.[p.id];
                const holdingCount = ret?.holdingCount ?? 0;
                const displayStatus = programDisplayStatus(p, holdingCount);
                const returnPct = ret?.totalReturnPct;
                const boxEntry = boxRangeStatus?.programs[p.id];
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
                      boxRangeBoxes={
                        portalSourceOnly ? undefined : boxEntry?.boxes
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );

  return (
    <LiveTradeFeeRatesProvider feeRates={effectiveStatus?.feeRates}>
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

      {loadErr && user ? (
        <div className="alert alert--error" role="alert">
          {loadErr}
        </div>
      ) : null}

      {!portalSourceOnly && !authChecked ? (
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      ) : null}

      {!portalSourceOnly && authChecked && !user ? (
        <LiveTradeAuthPanel
          user={null}
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
        statusPending && !portalSourceOnly ? (
          <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
        ) : (
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
          {showRunningPanelInline || showRunningPanelInDock ? (
            <>
              {showRunningPanelInline ? (
                <LiveSimRunningPanel
                  programs={programs}
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
              {showRunningPanelInDock && sidePanel ? (
                <LiveTradeSidePanelPortal
                  active
                  hostEl={sidePanel.bodyHostEl}
                >
                  <LiveSimRunningPanel
                    programs={programs}
                    busy={busy}
                    refreshKey={portfolioRefreshKey}
                    adminViewUserId={adminReadOnly ? adminViewUserId : null}
                    readOnly={adminReadOnly}
                    onStop={(id) => void handleSimStop(id)}
                    onDisarm={(id) => void handleDisarm(id)}
                    onProgramUpdated={() => void reload()}
                    onOpenHoldingChart={onOpenHoldingChart}
                  />
                </LiveTradeSidePanelPortal>
              ) : null}
              {!portalSourceOnly && !showMainProgramsList ? (
                <>
                  <LiveTradeHistoryScenarioTabs
                    value={tradeHistoryScenario}
                    onChange={setTradeHistoryScenario}
                    className="live-trading-tab__programs-trade-scenario"
                  />
                  {tradeHistoryScenario === "sim" ? (
                    <LiveTradeHistorySimSection
                      loadAll
                      adminViewUserId={adminReadOnly ? adminViewUserId : null}
                      programs={programs}
                      programReturns={effectiveStatus?.programReturns}
                    />
                  ) : (
                    <LiveTradeTradesHistoryPanel
                      scenario={tradeHistoryScenario}
                      loadAll
                      adminViewUserId={adminReadOnly ? adminViewUserId : null}
                    />
                  )}
                </>
              ) : null}
            </>
          ) : null}

          {showMainProgramsList ? (
            <section
              className="live-trading-tab__list live-trading-tab__list--main-expanded card"
              aria-label={ko.app.liveTradeListTitle}
            >
              <header className="live-trading-tab__list-main-head">
                <h3 className="live-trading-tab__section-title">
                  {ko.app.liveTradeListTitle}
                </h3>
                <p className="live-trading-tab__list-main-summary">
                  {programsListSummary}
                </p>
              </header>
              <div className="live-trading-tab__list-body">{programsListContent}</div>
            </section>
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
                  selfOnly={dockSelfOnly}
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
            <form
              className="live-trading-tab__form-panel"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
            >
              {!editingId ? (
                <LiveSimRecommendationsPanel
                  onApplyPatch={(patch: LiveSimDraftPatch) => {
                    const patchMarkets =
                      patch.marketsUs === true
                        ? { marketsUs: true }
                        : patch.marketsCrypto === true
                          ? { marketsCrypto: true }
                          : patch.marketsKr === true
                            ? { marketsKr: true }
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
                        {m.id === BOX_RANGE_MODEL_ID
                          ? m.name
                          : `${m.name} (max ${m.maxTechScore}점)`}
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
                        setDraft((d) => {
                          const next = { ...d, marketsKr: !d.marketsKr };
                          if (
                            !next.marketsKr &&
                            !next.marketsUs &&
                            !next.marketsCrypto
                          ) {
                            return d;
                          }
                          return next;
                        })
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
                        setDraft((d) => {
                          const next = { ...d, marketsUs: !d.marketsUs };
                          if (
                            !next.marketsKr &&
                            !next.marketsUs &&
                            !next.marketsCrypto
                          ) {
                            return d;
                          }
                          return next;
                        })
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
                        setDraft((d) => {
                          const next = { ...d, marketsCrypto: !d.marketsCrypto };
                          if (
                            !next.marketsKr &&
                            !next.marketsUs &&
                            !next.marketsCrypto
                          ) {
                            return d;
                          }
                          return next;
                        })
                      }
                    >
                      {ko.app.liveTradeMarketCrypto}
                    </button>
                  </div>
                </div>

                {isBoxRangeDraft ? (
                  <p className="live-trading-tab__hint live-trading-tab__field--full">
                    {ko.app.liveTradeBoxRangeMinScoreHint}
                  </p>
                ) : (
                  <div className="live-trading-tab__field live-trading-tab__field--range">
                    <div className="live-trading-tab__field-top">
                      <span className="live-trading-tab__label">
                        {ko.app.liveTradeFieldMinScore}
                      </span>
                      <span className="live-trading-tab__range-val">
                        {Math.round(minScoreSliderValue * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      className="live-trading-tab__range"
                      min={0.7}
                      max={1}
                      step={0.01}
                      value={minScoreSliderValue}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          minScoreRatio: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                )}

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
                    {krwAmountFieldLabel(
                      draft.marketsCrypto && !draft.marketsKr,
                    )}
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
                      {draft.marketsCrypto
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

              {isBoxRangeDraft ? (
                <>
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
                          setDraft((d) => ({
                            ...d,
                            simAutoBuy: e.target.checked,
                          }))
                        }
                      />
                      <span>{ko.app.liveTradeFieldSimAutoBuy}</span>
                    </label>
                  </div>
                  <p className="live-trading-tab__form-footnote">
                    {ko.app.liveTradeBoxRangeExitHint}
                  </p>
                </>
              ) : (
                <>
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
                          setDraft((d) => ({
                            ...d,
                            simAutoBuy: e.target.checked,
                          }))
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
                              sellHorizon: e.target.value as
                                | "short"
                                | "medium"
                                | "long",
                            }))
                          }
                        >
                          <option value="short">
                            {ko.app.liveTradeSellHorizonShort}
                          </option>
                          <option value="medium">
                            {ko.app.liveTradeSellHorizonMedium}
                          </option>
                          <option value="long">
                            {ko.app.liveTradeSellHorizonLong}
                          </option>
                        </select>
                      </label>
                      <p className="live-trading-tab__form-footnote">
                        {ko.app.liveTradeAutoExitHint}
                      </p>
                    </>
                  ) : null}
                </>
              )}

              <div className="live-trading-tab__actions">
                <button
                  type="submit"
                  className="btn btn--primary live-trading-tab__submit"
                  disabled={busy}
                  aria-disabled={busy}
                >
                  {busy
                    ? ko.app.liveTradeSaving
                    : editingId
                      ? ko.app.liveTradeSave
                      : ko.app.liveTradeRegister}
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
              {!busy && saveBlockedHint ? (
                <p className="live-trading-tab__form-save-hint" role="status">
                  {saveBlockedHint}
                </p>
              ) : null}

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
            </form>
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
          <div className="live-trading-tab__list-body live-trading-tab__list-body--dock">
            {programsListContent}
          </div>
        </LiveTradeCollapsibleCard>
              </div>
            </LiveTradeCardWorkspace>
            {!portalSourceOnly ? <LiveTradeCardSidePanelInline /> : null}
            </div>
          ) : null}
        </>
        )
      ) : null}
    </div>
    </LiveTradeFeeRatesProvider>
  );
}
