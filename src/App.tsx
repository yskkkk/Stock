import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChartDrawMagnet } from "./hooks/useChartDrawMagnet";
import {
  clearStockOpsInstructionDraft,
  clearStoredAccessAdminToken,
  fetchConfig,
  fetchAccessStatus,
  fetchNews,
  fetchPicks,
  fetchStock,
  fetchTelegramSent,
  refreshPicks,
  resetTelegramAlertHistory,
  type LiveTradeHolding,
} from "./api";
import BullishReasonModal from "./components/BullishReasonModal";
import AccessAdminModal from "./components/AccessAdminModal";
import AppSiteFooter from "./components/AppSiteFooter";
import AppThemeCorner from "./components/AppThemeCorner";
import FeedbackCorner, {
  type FeedbackCornerHandle,
  type FeedbackSubmitKind,
} from "./components/FeedbackCorner";
import EarningsUpcomingIconRail from "./components/EarningsUpcomingIconRail";
import MacroEventsBar from "./components/MacroEventsBar";
import LeftRailBithumbAccountPanel from "./components/LeftRailBithumbAccountPanel";
import LeftRailLiveTradeAuthPanel from "./components/LeftRailLiveTradeAuthPanel";
import LiveTradingHeaderStrip from "./components/LiveTradingHeaderStrip";
import TelegramNotifyIconButton from "./components/TelegramNotifyIconButton";
import LiveTradingLeftRailPanel from "./components/LiveTradingLeftRailPanel";
import MarketIndicesBelt from "./components/MarketIndicesBelt";
import NewsModal from "./components/NewsModal";
import PicksHistoryModal from "./components/PicksHistoryModal";
import ProfitModelModal from "./components/ProfitModelModal";
import ScreenFailuresModal from "./components/ScreenFailuresModal";
import TelegramSentModal from "./components/TelegramSentModal";
import PickList from "./components/PickList";
import PickQuoteStrip from "./components/PickQuoteStrip";
import QuoteCurrencyToggle from "./components/QuoteCurrencyToggle";
import PickToolbar from "./components/PickToolbar";
import SignalFilter from "./components/SignalFilter";
import type { ChartDrawMode, ChartDrawToolbarApi } from "./chartDrawTypes";
import ChartDrawToolbarButtons from "./components/ChartDrawToolbarButtons";
import CryptoTab from "./components/CryptoTab";
import OpsGlobalQueueStrip from "./components/OpsGlobalQueueStrip";
import OpsManagementTab from "./components/OpsManagementTab";
import LiveTradingTab, {
  type LiveTradeAdminViewState,
} from "./components/LiveTradingTab";
import AppLiveTradeSideDock from "./components/AppLiveTradeSideDock";
import AppRightDockRailPanels from "./components/AppRightDockRailPanels";
import {
  LiveTradeCardSidePanelProvider,
  useLiveTradeAuth,
} from "./components/LiveTradeAuthAndCredentials";
import RecommendationsTab from "./components/RecommendationsTab";
import StockSearchTab from "./components/StockSearchTab";
import StockChart from "./components/StockChart";
import TradingViewAdvancedChart from "./components/TradingViewAdvancedChart";
import { CHART_TIMEFRAMES } from "./constants/timeframes";
import type { SignalId } from "./constants/signals";
import {
  ENABLE_THEME_MODE_TOGGLE,
  SHOW_PROFIT_MODEL_BUTTON,
} from "./constants/uiFlags";
import { useMobileBackHandler } from "./hooks/useMobileBackHandler";
import { useDesktopDockLayout } from "./hooks/useDesktopDockLayout";
import { useLeftRailLazyFollow } from "./hooks/useLeftRailLazyFollow";
import { useMobilePullToRefresh } from "./hooks/useMobilePullToRefresh";
import { usePicksLiveQuotes } from "./hooks/usePicksLiveQuotes";
import { MOBILE_BACK_PRIORITY } from "./lib/mobileBackStack";
import { mergeQuotesIntoPicks } from "./lib/mergePickQuotes";
import { usePickKeyboard } from "./hooks/usePickKeyboard";
import { useMarketIndices } from "./hooks/useMarketIndices";
import { useUsdKrwRate } from "./hooks/useUsdKrwRate";
import { resolveUsQuoteDisplay } from "./lib/usQuoteDisplay";
import {
  dispatchLiveTradeDockOpenPortfolio,
  dispatchLiveTradePortfolioFocus,
  setPendingLiveTradePortfolioFocus,
} from "./lib/liveTradePortfolioFocus";
import { enrichBullishPick } from "./lib/bullishPicks";
import {
  filterPicksBySignals,
  type FilterMode,
} from "./lib/filterPicks";
import { formatEta, formatPercent, formatPrice, formatRescanCountdown, formatSignedMoney, formatUpdatedAt, resolveNextScanAt } from "./lib/format";
import { computeProfitFromEntry } from "./lib/profitModel";
import { findChartTimeNearEntryMs } from "./lib/profitMarker";
import {
  applyLightPalette,
  applyTheme,
  persistLightPalette,
  persistTheme,
  readStoredLightPalette,
  readStoredTheme,
  type ColorMode,
  type LightPaletteId,
} from "./lib/theme";
import {
  getBrowserUserId,
  getPersistedProfitRow,
  persistProfitEntry,
  persistProfitSell,
} from "./lib/userPersist";
import { filterPicksByQuery } from "./lib/searchPicks";
import { liveHoldingToStockPick } from "./lib/liveHoldingToPick";
import { startBackgroundTabPrefetch } from "./lib/tabPrefetch";
import { SHOW_OPS_GLOBAL_DEV_QUEUE_UI } from "./constants/opsDevQueuePoll";
import { warmOpsDevQueueDisplay } from "./lib/opsDevQueueDisplayClient";
import { sortPicksList, type SortKey } from "./lib/sortPicks";
import { yahooStockSymbolToTradingView } from "./lib/tradingviewSymbols";
import { failedCountLabel, ko, nextRescanCountdown } from "./i18n/ko";
import type {
  Candle,
  ChartTimeframe,
  Market,
  NewsItem,
  PicksResponse,
  QuoteResponse,
  StockPick,
  MarketIndexItem,
  TelegramSentItem,
} from "./types";

export type AppTab =
  | "screener"
  | "recommendations"
  | "liveTrading"
  | "stockLookup"
  | "crypto"
  | "ops";

type StockChartEngine = "tradingview" | "app";

const US_QUOTE_KRW_KEY = "stock_us_quote_krw";

function readUsQuoteKrwPref(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(US_QUOTE_KRW_KEY) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const [picks, setPicks] = useState<PicksResponse | null>(null);
  const [picksError, setPicksError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [telegramNotify, setTelegramNotify] = useState(false);
  const [telegramSentCount, setTelegramSentCount] = useState(0);
  const [resettingTelegram, setResettingTelegram] = useState(false);
  const [appTab, setAppTab] = useState<AppTab>("stockLookup");
  const prevAppTabRef = useRef<AppTab>("stockLookup");
  /** 실거래 보유 → 종목검색: 탭 진입 시 lookupSelected 초기화 effect 건너뜀 */
  const skipLookupResetRef = useRef(false);
  /** 실거래에서 넘어온 심볼 — 종목검색 탭에서 자동 검색 */
  const [lookupSeedQuery, setLookupSeedQuery] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>(() => readStoredTheme());
  const [lightPalette, setLightPalette] = useState<LightPaletteId>(() =>
    readStoredLightPalette(),
  );
  const [screenerMarketTab, setScreenerMarketTab] = useState<Market>("kr");
  const [lookupMarketTab, setLookupMarketTab] = useState<Market>("kr");
  /** 수동 국내↔나스닥 탭 전환 시에만 증가 — 자동 교차 시장 검색 시 검색창·조건 유지 */
  const [lookupSearchTabMountKey, setLookupSearchTabMountKey] = useState(0);
  const [lookupHotToolbar, setLookupHotToolbar] = useState({
    visible: false,
    showUsToggle: false,
  });
  const [usQuoteInKrw, setUsQuoteInKrw] = useState(readUsQuoteKrwPref);
  const [cryptoFocusSymbol, setCryptoFocusSymbol] = useState<string | null>(null);
  const [signalFilters, setSignalFilters] = useState<SignalId[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("and");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [screenerSelected, setScreenerSelected] = useState<StockPick | null>(null);
  const [lookupSelected, setLookupSelected] = useState<StockPick | null>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1m");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dailyCandles, setDailyCandles] = useState<Candle[]>([]);
  const [chartInterval, setChartInterval] = useState("1m");
  const [candleCount, setCandleCount] = useState(0);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartStale, setChartStale] = useState(false);
  const [chartEngine, setChartEngine] = useState<StockChartEngine>("app");

  useEffect(() => {
    const prev = prevAppTabRef.current;
    prevAppTabRef.current = appTab;
    if (appTab !== "stockLookup") return;
    if (prev === "stockLookup") return;
    if (skipLookupResetRef.current) {
      skipLookupResetRef.current = false;
      return;
    }
    setLookupSeedQuery(null);
    setLookupSelected(null);
    setCandles([]);
    setDailyCandles([]);
    setChartError(null);
    setChartStale(false);
    setCandleCount(0);
    setChartInterval(timeframe);
    setQuote(null);
    setChartLoading(false);
  }, [appTab, timeframe]);

  const [chartDrawMode, setChartDrawMode] = useState<ChartDrawMode>("cursor");
  const [chartDrawMagnet, setChartDrawMagnet] = useChartDrawMagnet();
  const chartDrawApiRef = useRef<ChartDrawToolbarApi | null>(null);
  const [showMa, setShowMa] = useState(true);
  const [showIchimoku, setShowIchimoku] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [newsPick, setNewsPick] = useState<StockPick | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [reasonPick, setReasonPick] = useState<StockPick | null>(null);
  const [showScreenFailures, setShowScreenFailures] = useState(false);
  const [showTelegramSent, setShowTelegramSent] = useState(false);
  const [telegramSentItems, setTelegramSentItems] = useState<TelegramSentItem[]>(
    [],
  );
  const [telegramSentLoading, setTelegramSentLoading] = useState(false);
  const [telegramSentError, setTelegramSentError] = useState<string | null>(null);
  const [picksHistoryOpen, setPicksHistoryOpen] = useState(false);
  const [rescanClockMs, setRescanClockMs] = useState(() => Date.now());
  const [profitPersistTick, setProfitPersistTick] = useState(0);
  const [profitModalOpen, setProfitModalOpen] = useState(false);
  const newsReqIdRef = useRef(0);
  const newsAbortRef = useRef<AbortController | null>(null);
  const chartAbortRef = useRef<AbortController | null>(null);
  const [showAccessAdmin, setShowAccessAdmin] = useState(false);
  const [adminIpConsole, setAdminIpConsole] = useState(false);
  const [accessAdmin, setAccessAdmin] = useState(false);
  const [liveTradeAdminView, setLiveTradeAdminView] =
    useState<LiveTradeAdminViewState | null>(null);
  const [opsCursorAgentAvailable, setOpsCursorAgentAvailable] = useState(false);
  /** /api/config 완료 전에는 IP 게이트 리다이렉트 금지(관리자 대기열 깜빡임 방지) */
  const [configReady, setConfigReady] = useState(false);

  const closeNews = useCallback(() => {
    newsReqIdRef.current += 1;
    newsAbortRef.current?.abort();
    newsAbortRef.current = null;
    setNewsPick(null);
    setNewsItems([]);
    setNewsError(null);
    setNewsLoading(false);
  }, []);

  const mobileBackPrevTabRef = useRef<AppTab>("stockLookup");
  const lastTabForBackRef = useRef<AppTab>("stockLookup");
  useEffect(() => {
    if (appTab !== lastTabForBackRef.current) {
      mobileBackPrevTabRef.current = lastTabForBackRef.current;
      lastTabForBackRef.current = appTab;
    }
  }, [appTab]);

  const clearWorkspacePick = useCallback(() => {
    if (appTab === "screener") setScreenerSelected(null);
    else if (appTab === "stockLookup") setLookupSelected(null);
  }, [appTab]);

  const hasWorkspacePickForBack =
    appTab === "screener"
      ? Boolean(screenerSelected)
      : appTab === "stockLookup"
        ? Boolean(lookupSelected)
        : false;

  useMobileBackHandler(
    showAccessAdmin,
    MOBILE_BACK_PRIORITY.ACCESS_ADMIN,
    () => setShowAccessAdmin(false),
  );
  useMobileBackHandler(
    Boolean(SHOW_PROFIT_MODEL_BUTTON && profitModalOpen && hasWorkspacePickForBack),
    MOBILE_BACK_PRIORITY.PROFIT,
    () => setProfitModalOpen(false),
  );
  useMobileBackHandler(
    showTelegramSent,
    MOBILE_BACK_PRIORITY.TELEGRAM_SENT,
    () => setShowTelegramSent(false),
  );
  useMobileBackHandler(
    showScreenFailures,
    MOBILE_BACK_PRIORITY.SCREEN_FAILURES,
    () => setShowScreenFailures(false),
  );
  useMobileBackHandler(
    picksHistoryOpen,
    MOBILE_BACK_PRIORITY.PICKS_HISTORY,
    () => setPicksHistoryOpen(false),
  );
  useMobileBackHandler(
    Boolean(reasonPick),
    MOBILE_BACK_PRIORITY.REASON,
    () => setReasonPick(null),
  );
  useMobileBackHandler(Boolean(newsPick), MOBILE_BACK_PRIORITY.NEWS, closeNews);
  useMobileBackHandler(
    chartDrawMode !== "cursor",
    MOBILE_BACK_PRIORITY.CHART_DRAW,
    () => setChartDrawMode("cursor"),
  );
  useMobileBackHandler(
    appTab !== "stockLookup",
    MOBILE_BACK_PRIORITY.TAB,
    () => setAppTab(mobileBackPrevTabRef.current),
  );
  useMobileBackHandler(
    hasWorkspacePickForBack,
    MOBILE_BACK_PRIORITY.WORKSPACE_PICK,
    clearWorkspacePick,
  );

  const pollPicks = useCallback(async () => {
    try {
      const data = await fetchPicks();
      setPicks(data);
      setPicksError(null);
    } catch (err) {
      setPicksError(
        err instanceof Error ? err.message : ko.errors.picksLoad,
      );
    }
  }, []);

  useEffect(() => {
    void pollPicks();
    const ms = picks?.running ? 1_500 : 2_000;
    const id = window.setInterval(() => void pollPicks(), ms);
    return () => window.clearInterval(id);
  }, [pollPicks, picks?.running]);

  /** IP 허용이 해제되면 API 403 외에도 상태 폴링으로 즉시 게이트로 보낸다 */
  useEffect(() => {
    if (!configReady) return;

    let cancelled = false;
    let intervalId: number | null = null;

    async function tick() {
      try {
        const s = await fetchAccessStatus();
        if (cancelled) return;
        if (!s.enabled) {
          if (intervalId != null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          return;
        }
        if (s.state !== "allowed" && !accessAdmin && !adminIpConsole) {
          if (intervalId != null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          clearStoredAccessAdminToken();
          clearStockOpsInstructionDraft();
          window.location.replace("/access-gate.html");
          return;
        }
        if (intervalId == null && !cancelled) {
          intervalId = window.setInterval(() => void tick(), 6_000);
        }
      } catch {
        /* 네트워크 일시 오류 — 다음 틱에서 재시도 */
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [configReady, accessAdmin, adminIpConsole]);

  useEffect(() => {
    if (!configReady) return;
    startBackgroundTabPrefetch();
  }, [configReady]);

  useEffect(() => {
    if (
      !SHOW_OPS_GLOBAL_DEV_QUEUE_UI ||
      !configReady ||
      (!accessAdmin && !adminIpConsole)
    ) {
      return;
    }
    return warmOpsDevQueueDisplay();
  }, [configReady, accessAdmin, adminIpConsole]);

  const showOpsGlobalQueue =
    SHOW_OPS_GLOBAL_DEV_QUEUE_UI && (accessAdmin || adminIpConsole);

  useEffect(() => {
    applyTheme(colorMode);
    persistTheme(colorMode);
    if (colorMode === "light") {
      const id = readStoredLightPalette();
      setLightPalette(id);
      applyLightPalette(id);
    }
  }, [colorMode]);

  const handleLightPalette = useCallback((id: LightPaletteId) => {
    persistLightPalette(id);
    setLightPalette(id);
    applyLightPalette(id);
  }, []);

  useEffect(() => {
    if (!picks || picks.running) return;
    if (resolveNextScanAt(picks) == null) return;
    const id = window.setInterval(() => setRescanClockMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [
    picks?.running,
    picks?.nextScanAt,
    picks?.updatedAt,
    picks?.scanIntervalMs,
  ]);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((cfg) => {
        if (cancelled) return;
        setTelegramNotify(cfg.telegramNotify?.enabled ?? false);
        setTelegramSentCount(cfg.telegramNotify?.todaySentCount ?? 0);
        setAdminIpConsole(cfg.adminIpConsole ?? false);
        setAccessAdmin(cfg.accessAdmin ?? false);
        setOpsCursorAgentAvailable(cfg.opsCursorAgentAvailable ?? false);
      })
      .catch(() => {
        if (cancelled) return;
        setTelegramNotify(false);
        setAdminIpConsole(false);
        setAccessAdmin(false);
        setOpsCursorAgentAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setConfigReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const browserUserId = useMemo(() => getBrowserUserId(), []);

  const listLiveQuotes = usePicksLiveQuotes(picks, appTab === "screener");
  const picksForList = useMemo(
    () => (picks ? mergeQuotesIntoPicks(picks, listLiveQuotes) : null),
    [picks, listLiveQuotes],
  );

  const krFiltered = useMemo(
    () =>
      filterPicksBySignals(picksForList?.kr ?? picks?.kr ?? [], signalFilters, filterMode),
    [picksForList?.kr, picks?.kr, signalFilters, filterMode],
  );
  const usFiltered = useMemo(
    () =>
      filterPicksBySignals(picksForList?.us ?? picks?.us ?? [], signalFilters, filterMode),
    [picksForList?.us, picks?.us, signalFilters, filterMode],
  );
  const cryptoFiltered = useMemo(
    () =>
      filterPicksBySignals(
        picksForList?.crypto ?? picks?.crypto ?? [],
        signalFilters,
        filterMode,
      ),
    [picksForList?.crypto, picks?.crypto, signalFilters, filterMode],
  );
  const baseListPicks = useMemo(() => {
    if (screenerMarketTab === "kr") return krFiltered;
    if (screenerMarketTab === "crypto") return cryptoFiltered;
    return usFiltered;
  }, [screenerMarketTab, krFiltered, usFiltered, cryptoFiltered]);

  const listPicks = useMemo(
    () => sortPicksList(filterPicksByQuery(baseListPicks, searchQuery), sortKey),
    [baseListPicks, searchQuery, sortKey],
  );

  const rawCount =
    screenerMarketTab === "kr"
      ? (picks?.kr.length ?? 0)
      : screenerMarketTab === "crypto"
        ? (picks?.crypto?.length ?? 0)
        : (picks?.us.length ?? 0);

  const workspacePick = useMemo(() => {
    if (appTab === "crypto" || appTab === "ops" || appTab === "liveTrading") {
      return null;
    }
    return appTab === "stockLookup" ? lookupSelected : screenerSelected;
  }, [appTab, lookupSelected, screenerSelected]);

  const workspacePickRef = useRef<StockPick | null>(null);
  workspacePickRef.current = workspacePick;

  const stockChartSectionRef = useRef<HTMLElement | null>(null);
  const appScrollRef = useRef<HTMLDivElement>(null);
  const leftRailRef = useRef<HTMLElement>(null);
  useLeftRailLazyFollow(leftRailRef, appScrollRef);
  const desktopDockLayout = useDesktopDockLayout();
  const feedbackRef = useRef<FeedbackCornerHandle>(null);
  const [footerFeedbackKind, setFooterFeedbackKind] = useState<FeedbackSubmitKind | null>(
    null,
  );
  const pullToRefreshHintRef = useRef<HTMLDivElement>(null);
  useMobilePullToRefresh(appScrollRef, pullToRefreshHintRef, {
    pullHint: ko.app.pullToRefreshHint,
    releaseHint: ko.app.pullToRefreshRelease,
  });

  /** 모바일: 목록 아래 차트가 잘리지 않도록 선택 시 차트 블록으로 스크롤 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!workspacePick) return;
    if (appTab === "crypto" || appTab === "ops") return;
    if (window.innerWidth > 900) return;
    const el = stockChartSectionRef.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }, 90);
    return () => window.clearTimeout(t);
  }, [workspacePick?.symbol, workspacePick?.market, appTab]);

  const { rate: usdKrwRate, valuationDate: usdKrwValDate } = useUsdKrwRate(true);
  const {
    items: marketIndices,
    loading: marketIndicesLoading,
  } = useMarketIndices(true);

  const toggleUsQuoteKrw = useCallback(() => {
    setUsQuoteInKrw((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(US_QUOTE_KRW_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleOpenTelegramSent = useCallback(async () => {
    setShowTelegramSent(true);
    setTelegramSentLoading(true);
    setTelegramSentError(null);
    try {
      const data = await fetchTelegramSent();
      setTelegramSentItems(data.items);
      setTelegramSentCount(data.count);
    } catch (err) {
      setTelegramSentItems([]);
      setTelegramSentError(
        err instanceof Error ? err.message : ko.app.telegramListLoadFail,
      );
    } finally {
      setTelegramSentLoading(false);
    }
  }, []);

  const handleResetTelegramSent = useCallback(async () => {
    const ok = window.confirm(ko.app.telegramConfirm);
    if (!ok) return;
    setResettingTelegram(true);
    try {
      const res = await resetTelegramAlertHistory();
      setTelegramSentCount(0);
      setTelegramSentItems([]);
      window.alert(res.message);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : ko.app.telegramResetFail,
      );
    } finally {
      setResettingTelegram(false);
    }
  }, []);

  /** 종목 검색 탭에서 국내 ↔ 나스닥 전환 시 검색·선택·차트를 비움 */
  const resetStockLookupSession = useCallback(() => {
    setLookupSeedQuery(null);
    setLookupSelected(null);
    setCandles([]);
    setDailyCandles([]);
    setChartError(null);
    setChartStale(false);
    setCandleCount(0);
    setChartInterval(timeframe);
    setQuote(null);
    setChartLoading(false);
  }, [timeframe]);

  const handleLookupSelect = useCallback((pick: StockPick) => {
    setLookupSelected(pick);
    setLookupMarketTab(pick.market);
  }, []);

  const handleLookupPickPatch = useCallback(
    (patch: {
      symbol: string;
      market: Market;
      score: number;
      signalIds: string[];
      signals: string[];
    }) => {
      setLookupSelected((prev) => {
        if (!prev || prev.symbol.trim().toUpperCase() !== patch.symbol.trim().toUpperCase()) {
          return prev;
        }
        return {
          ...prev,
          score: patch.score,
          signalIds: patch.signalIds,
          signals: patch.signals,
        };
      });
    },
    [],
  );

  const handleSelect = useCallback((pick: StockPick) => {
    setAppTab("screener");
    setScreenerSelected(pick);
    setScreenerMarketTab(pick.market);
  }, []);

  const handleLiveTradeChart = useCallback((h: LiveTradeHolding) => {
    if (h.market === "crypto") {
      setCryptoFocusSymbol(h.symbol);
      setAppTab("crypto");
      return;
    }
    const pick = liveHoldingToStockPick(h);
    skipLookupResetRef.current = true;
    setLookupSeedQuery(pick.symbol);
    setLookupSelected(pick);
    setLookupMarketTab(pick.market);
    setAppTab("stockLookup");
  }, []);

  const openAdminLiveTradeView = useCallback(
    (p: { programId: string; userId?: string; name: string }) => {
      const uid = String(p.userId ?? "").trim();
      if (!uid) return;
      setShowAccessAdmin(false);
      setLiveTradeAdminView({
        userId: uid,
        label: uid,
        programId: p.programId,
        programName: p.name,
      });
      setAppTab("liveTrading");
      const focus = {
        programId: p.programId,
        userId: uid,
        programName: p.name,
      };
      setPendingLiveTradePortfolioFocus(focus);
      requestAnimationFrame(() => {
        dispatchLiveTradeDockOpenPortfolio();
        dispatchLiveTradePortfolioFocus(focus);
      });
    },
    [],
  );

  const handleOpenMarketIndex = useCallback((item: MarketIndexItem) => {
    const market = item.lookupMarket ?? item.region;
    const pick: StockPick = {
      symbol: item.symbol,
      name: item.label,
      market,
      score: 0,
      signals: [],
      price: item.price ?? undefined,
      changePercent: item.changePercent ?? undefined,
      currency: item.currency,
    };
    skipLookupResetRef.current = true;
    setLookupSeedQuery(item.symbol);
    setLookupSelected(pick);
    setLookupMarketTab(market);
    setAppTab("stockLookup");
  }, []);

  const handleCryptoFocusConsumed = useCallback(() => {
    setCryptoFocusSymbol(null);
  }, []);

  const deepLinkHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!picks || picks.running) return;
    const q = window.location.search;
    if (!q || q.length < 2) {
      deepLinkHandledRef.current = null;
      return;
    }
    const params = new URLSearchParams(q);
    const sym = params.get("symbol")?.trim().toUpperCase();
    const mkt = params.get("market")?.toLowerCase();
    if (!sym || (mkt !== "kr" && mkt !== "us" && mkt !== "crypto")) {
      deepLinkHandledRef.current = null;
      return;
    }
    const key = `${mkt}:${sym}`;
    if (deepLinkHandledRef.current === key) return;
    const all = [...(picks.kr ?? []), ...(picks.us ?? []), ...(picks.crypto ?? [])];
    const fromList = all.find(
      (p) => p.symbol.toUpperCase() === sym && p.market === mkt,
    );
    const pick: StockPick =
      fromList ??
      ({
        symbol: sym,
        name: sym,
        market: mkt as Market,
        score: 0,
        signals: [],
      } as StockPick);
    deepLinkHandledRef.current = key;
    handleSelect(pick);
    const path = window.location.pathname || "/";
    window.history.replaceState({}, "", path);
  }, [picks, picks?.running, handleSelect]);

  /** 목록이 있을 때 선택이 없거나 필터·시장 탭 때문에 목록 밖이면 첫 종목 차트를 연다 */
  useEffect(() => {
    if (appTab !== "screener") return;
    if (picks?.running) return;
    if (listPicks.length === 0) return;
    const sym = (screenerSelected?.symbol ?? "").trim().toUpperCase();
    const inList =
      sym && listPicks.some((p) => p.symbol.trim().toUpperCase() === sym);
    if (!inList) handleSelect(listPicks[0]);
  }, [appTab, picks?.running, listPicks, screenerSelected, handleSelect]);

  usePickKeyboard(
    listPicks,
    screenerSelected?.symbol ?? null,
    handleSelect,
    appTab === "screener" &&
      listPicks.length > 0 &&
      !newsPick &&
      !reasonPick &&
      !showScreenFailures &&
      !showTelegramSent &&
      !profitModalOpen &&
      !showAccessAdmin,
  );

  /** picks 폴링으로 목록 시세가 바뀌면 선택 종목 객체도 동기화(차트 상단·참조 일치) */
  useEffect(() => {
    if (appTab !== "screener" || !picks || picks.running || !screenerSelected) return;
    const sym = screenerSelected.symbol.trim().toUpperCase();
    const next = [...(picks.kr ?? []), ...(picks.us ?? []), ...(picks.crypto ?? [])].find(
      (p) => p.symbol.trim().toUpperCase() === sym,
    );
    if (!next) return;
    if (
      next.price === screenerSelected.price &&
      next.changePercent === screenerSelected.changePercent &&
      next.change === screenerSelected.change
    ) {
      return;
    }
    setScreenerSelected(next);
  }, [appTab, picks, picks?.running, screenerSelected]);

  useEffect(() => {
    setProfitModalOpen(false);
    setProfitPersistTick((t) => t + 1);
  }, [workspacePick?.symbol]);

  const loadChart = useCallback(
    async (pick: StockPick, tf: ChartTimeframe, live = false) => {
      chartAbortRef.current?.abort();
      const ac = new AbortController();
      chartAbortRef.current = ac;

      setChartError(null);
      if (!live) {
        setChartLoading(true);
        setQuote(null);
        setCandles([]);
        setDailyCandles([]);
        setCandleCount(0);
      }
      try {
        const data = await fetchStock(pick.symbol, tf, live, ac.signal);
        if (chartAbortRef.current !== ac) return;
        setQuote(data.quote);
        setCandles(data.candles);
        setDailyCandles(
          tf === "1d" ? data.candles : (data.dailyCandles ?? []),
        );
        setChartInterval(data.interval ?? tf);
        setCandleCount(data.candleCount ?? data.candles.length);
        setChartStale(Boolean(data.stale));
      } catch (err) {
        if (
          ac.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        if (chartAbortRef.current !== ac) return;
        setChartError(
          err instanceof Error ? err.message : ko.errors.chartLoad,
        );
        setChartStale(false);
        setQuote({
          symbol: pick.symbol,
          name: pick.name,
          price: pick.price,
          changePercent: pick.changePercent,
          currency: pick.currency,
        });
        setCandles([]);
        setDailyCandles([]);
        setCandleCount(0);
      } finally {
        if (chartAbortRef.current === ac) {
          setChartLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const pick = workspacePickRef.current;
    if (!pick || appTab === "crypto" || appTab === "ops") return;
    loadChart(pick, timeframe);
    const refreshMs = timeframe === "1m" ? 1_000 : 8_000;
    const id = window.setInterval(() => {
      const p = workspacePickRef.current;
      if (!p) return;
      loadChart(p, timeframe, true);
    }, refreshMs);
    return () => {
      window.clearInterval(id);
      chartAbortRef.current?.abort();
    };
  }, [workspacePick?.symbol, workspacePick?.market, timeframe, loadChart, appTab]);

  const handleReason = useCallback((pick: StockPick) => {
    closeNews();
    setReasonPick(enrichBullishPick(pick));
  }, [closeNews]);

  async function handleRescan() {
    setRescanning(true);
    try {
      await refreshPicks();
      await pollPicks();
    } catch (e) {
      setPicksError(e instanceof Error ? e.message : String(e));
    } finally {
      setRescanning(false);
    }
  }

  const handleNews = useCallback(async (pick: StockPick) => {
    newsAbortRef.current?.abort();
    const ac = new AbortController();
    newsAbortRef.current = ac;
    const reqId = ++newsReqIdRef.current;

    setReasonPick(null);
    setNewsPick(pick);
    setNewsItems([]);
    setNewsError(null);
    setNewsLoading(true);

    try {
      const data = await fetchNews(pick.symbol, pick.name, ac.signal);
      if (reqId !== newsReqIdRef.current) return;
      setNewsItems(data.items);
    } catch (err) {
      if (reqId !== newsReqIdRef.current) return;
      if (ac.signal.aborted) return;
      setNewsError(
        err instanceof Error ? err.message : ko.errors.newsLoad,
      );
    } finally {
      if (reqId === newsReqIdRef.current) {
        setNewsLoading(false);
      }
    }
  }, []);

  const progress =
    picks && picks.total > 0
      ? Math.round((picks.progress / picks.total) * 100)
      : 0;
  const fitKey = workspacePick ? `${workspacePick.symbol}:${timeframe}` : "";
  const stockChartOverlays = useMemo(
    () => ({
      ma: showMa,
      ichimoku: showIchimoku,
      volume: showVolume,
      rsi: showRsi,
    }),
    [showMa, showIchimoku, showVolume, showRsi],
  );
  const registerStockDrawApi = useCallback((api: ChartDrawToolbarApi | null) => {
    chartDrawApiRef.current = api;
  }, []);
  const stockTvSymbol = useMemo(
    () =>
      workspacePick
        ? yahooStockSymbolToTradingView(
            workspacePick.symbol,
            workspacePick.market,
          )
        : "",
    [workspacePick],
  );

  useEffect(() => {
    setChartDrawMode("cursor");
  }, [workspacePick?.symbol, timeframe, chartInterval]);

  useEffect(() => {
    if (chartEngine === "tradingview") setChartDrawMode("cursor");
  }, [chartEngine]);
  const nativeQuotePx = quote?.price ?? workspacePick?.price;
  const nativeQuoteCur = quote?.currency ?? workspacePick?.currency;

  const chartQuoteDisplay = useMemo(
    () =>
      resolveUsQuoteDisplay(
        nativeQuotePx,
        nativeQuoteCur,
        workspacePick?.market ?? "kr",
        usQuoteInKrw,
        usdKrwRate,
      ),
    [
      nativeQuotePx,
      nativeQuoteCur,
      workspacePick?.market,
      usQuoteInKrw,
      usdKrwRate,
    ],
  );

  const stripQuotePx = chartQuoteDisplay.price ?? nativeQuotePx;
  const stripQuoteCur = chartQuoteDisplay.currency ?? nativeQuoteCur;
  const showChartKrwToggle = chartQuoteDisplay.showToggle;

  const canUsdToKrw = useMemo(
    () =>
      showChartKrwToggle &&
      usQuoteInKrw &&
      usdKrwRate != null &&
      usdKrwRate > 0 &&
      nativeQuotePx != null &&
      Number.isFinite(nativeQuotePx) &&
      nativeQuotePx > 0,
    [showChartKrwToggle, usQuoteInKrw, usdKrwRate, nativeQuotePx],
  );

  const toDisplayMoney = useCallback(
    (v: number | null | undefined): number | undefined => {
      if (v == null || !Number.isFinite(v)) return undefined;
      if (canUsdToKrw && usdKrwRate != null) return Math.round(v * usdKrwRate);
      return v;
    },
    [canUsdToKrw, usdKrwRate],
  );

  const profitRow = useMemo(
    () =>
      workspacePick ? getPersistedProfitRow(workspacePick.symbol) : null,
    [workspacePick?.symbol, profitPersistTick],
  );
  const profitEntry = profitRow?.entry ?? null;
  const profitModelResult = useMemo(
    () => computeProfitFromEntry(nativeQuotePx, profitEntry, profitRow?.exit),
    [nativeQuotePx, profitEntry, profitRow?.exit],
  );
  const profitMarker = useMemo(() => {
    if (!workspacePick || profitEntry == null || !(profitEntry > 0))
      return null;
    const ms = profitRow?.entryAtMs;
    if (!ms || candles.length === 0) return null;
    const t = findChartTimeNearEntryMs(ms, candles);
    if (!t) return null;
    return { time: t, price: profitEntry };
  }, [workspacePick?.symbol, profitEntry, profitRow?.entryAtMs, candles]);
  const profitStripTone =
    profitModelResult == null
      ? "flat"
      : profitModelResult.pct > 0
        ? "up"
        : profitModelResult.pct < 0
          ? "down"
          : "flat";
  const tfLabel =
    CHART_TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? timeframe;
  const etaLabel = picks?.running ? formatEta(picks.etaSeconds) : "";
  const nextRescanLabel = useMemo(() => {
    if (!picks || picks.running) return "";
    const nextAt = resolveNextScanAt(picks);
    if (nextAt == null) return "";
    const sec = Math.max(0, Math.ceil((nextAt - rescanClockMs) / 1000));
    if (sec <= 0) return nextRescanCountdown(ko.app.nextRescanSoon);
    return nextRescanCountdown(formatRescanCountdown(sec));
  }, [picks, rescanClockMs]);
  const failedLabel =
    picks?.failedCount && picks.failedCount > 0
      ? failedCountLabel(picks.failedCount)
      : "";
  const showTopScanStrip = Boolean(picks && appTab === "screener");
  const { user: liveTradeUser } = useLiveTradeAuth();
  const showDesktopSideDock = desktopDockLayout && appTab !== "ops";
  const showLiveTradeDockPortals = showDesktopSideDock && Boolean(liveTradeUser);
  const showEarningsViewportRail = desktopDockLayout && appTab !== "ops";
  return (
    <LiveTradeCardSidePanelProvider>
    <div
        className={
        appTab === "recommendations"
          ? "app app--rec-tracker"
          : appTab === "screener"
            ? "app app--screener"
            : appTab === "liveTrading"
              ? "app app--live-trade"
              : appTab === "ops"
                ? "app app--ops"
                : "app"
      }
    >
      <div className="app__scroll" ref={appScrollRef}>
      <div
        className={[
          desktopDockLayout
            ? "app__viewport app__viewport--no-left-rail"
            : "app__viewport",
          showEarningsViewportRail ? " app__viewport--earnings-rail" : "",
        ]
          .join("")
          .trim()}
      >
      {showEarningsViewportRail ? (
        <div className="app__viewport-earnings-rail">
          <EarningsUpcomingIconRail variant="edge" />
        </div>
      ) : null}
      {!desktopDockLayout ? (
        <div className="app__left-column">
          <aside ref={leftRailRef} className="app__left-rail" aria-label={ko.app.leftRailAria}>
            <LeftRailLiveTradeAuthPanel />
            <LeftRailBithumbAccountPanel
              onOpenLiveTrading={() => setAppTab("liveTrading")}
            />
            <LiveTradingLeftRailPanel
              onOpenLiveTrading={() => setAppTab("liveTrading")}
            />
          </aside>
        </div>
      ) : null}
      <div className="app__shell">
      <div className="app__shell-body">
      <div className="app__viewport-top">
        <AppThemeCorner
          colorMode={colorMode}
          lightPalette={lightPalette}
          onColorModeChange={(mode) => {
            if (!ENABLE_THEME_MODE_TOGGLE) return;
            setColorMode((m) => {
              if (m === mode) return m;
              persistTheme(mode);
              applyTheme(mode);
              if (mode === "light") applyLightPalette(readStoredLightPalette());
              return mode;
            });
          }}
          onLightPalette={handleLightPalette}
        />
        <MarketIndicesBelt
          items={marketIndices}
          loading={marketIndicesLoading}
          layout="top"
          onOpenItem={handleOpenMarketIndex}
        />
      </div>
      <div
        ref={pullToRefreshHintRef}
        className="app-ptr-hint"
        aria-live="polite"
        aria-atomic="true"
      />
      {showOpsGlobalQueue ? (
        <div
          className="app-page-top app-page-top--queue-only"
          aria-label={ko.app.opsGlobalQueueTitle}
        >
          <div className="app-page-top__queue">
            <OpsGlobalQueueStrip onOpenOps={() => setAppTab("ops")} />
          </div>
        </div>
      ) : null}
      <div className="app-header-sticky">
      <header
        className={`top-bar card${showTopScanStrip ? " top-bar--with-scan" : ""}${
          appTab === "screener" ? " top-bar--screener" : ""
        }`}
      >
        <div
          className={`top-bar__grid${showTopScanStrip ? " top-bar__grid--with-scan" : ""}`}
        >
          <div className="top-bar__macro">
            <MacroEventsBar onSecretAdminOpen={() => setShowAccessAdmin(true)} />
          </div>
          <div className="top-bar__header-left">
            <div className="top-bar__brand">
              <div className="top-bar__brand-lockup">
                <span className="brand-mark" aria-hidden>
                  <img
                    className="brand-mark__img"
                    src="/branding/ystock-logo-mark.png?v=19"
                    alt=""
                    width={40}
                    height={40}
                    decoding="async"
                  />
                </span>
                <h1>{ko.app.title}</h1>
              </div>
              <div className="top-bar__brand-main">
                <p className="top-bar__brand-tags">
                  <span className="top-bar__brand-tags__row">
                    <span className="top-bar__brand-tags__lead">
                      <span
                        className={
                          picks && picks.scanScopeKrActive === false
                            ? "top-bar__brand-tags__scope top-bar__brand-tags__scope--off"
                            : "top-bar__brand-tags__scope"
                        }
                      >
                        {ko.app.scanScopeKr}
                      </span>
                      <span className="top-bar__brand-tags__sep" aria-hidden>
                        {ko.app.scanScopeSep}
                      </span>
                      <span
                        className={
                          picks && picks.scanScopeUsActive === false
                            ? "top-bar__brand-tags__scope top-bar__brand-tags__scope--off"
                            : "top-bar__brand-tags__scope"
                        }
                      >
                        {ko.app.scanScopeUs}
                      </span>
                    </span>
                    {telegramNotify ? (
                      <TelegramNotifyIconButton
                        sentCount={telegramSentCount}
                        onClick={handleOpenTelegramSent}
                        className="top-bar__brand-tags__telegram"
                      />
                    ) : null}
                  </span>
                  {appTab === "screener" && (
                    <span className="tag-group">
                      <button
                        type="button"
                        className={
                          picksHistoryOpen
                            ? "tag tag--picks-history tag--picks-history-btn tag--picks-history-btn--active"
                            : "tag tag--picks-history tag--picks-history-btn"
                        }
                        title={ko.app.picksHistoryButtonAria}
                        aria-label={ko.app.picksHistoryButtonAria}
                        aria-expanded={picksHistoryOpen}
                        aria-controls={
                          picksHistoryOpen ? "picks-history-dialog" : undefined
                        }
                        onClick={() => setPicksHistoryOpen(true)}
                      >
                        {ko.app.picksHistoryButton}
                      </button>
                    </span>
                  )}
                </p>
              </div>
            </div>

            {showTopScanStrip && picks ? (
              <div className="top-bar__scan">
                <div className="scan-status scan-status--compact scan-status--bar">
                  <div className="scan-status__primary">
                    {picks.running && (
                      <div className="progress-bar" aria-hidden>
                        <div
                          className="progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                    <span className="scan-status__msg">{picks.message}</span>
                    {etaLabel && (
                      <span className="scan-status__eta">{etaLabel}</span>
                    )}
                  </div>
                  <div className="scan-status__secondary">
                    {failedLabel && (
                      <button
                        type="button"
                        className="scan-status__warn scan-status__fail-btn"
                        onClick={() => setShowScreenFailures(true)}
                        title={ko.app.failBtnTitle}
                      >
                        {failedLabel}
                      </button>
                    )}
                    {picks.updatedAt && !picks.running && (
                      <span className="scan-status__time">
                        {formatUpdatedAt(picks.updatedAt)}
                      </span>
                    )}
                    {nextRescanLabel && (
                      <span className="scan-status__next" title={nextRescanLabel}>
                        {nextRescanLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            <LiveTradingHeaderStrip
              onOpenLiveTrading={() => setAppTab("liveTrading")}
            />
          </div>

          <div className="top-bar__right">
            <nav className="main-tabs" aria-label={ko.app.mainNav}>
              <button
                type="button"
                className={
                  appTab === "stockLookup" ? "main-tab active" : "main-tab"
                }
                onClick={() => setAppTab("stockLookup")}
              >
                {ko.app.tabStockLookup}
              </button>
              <button
                type="button"
                className={appTab === "crypto" ? "main-tab active" : "main-tab"}
                onClick={() => setAppTab("crypto")}
              >
                {ko.app.tabCrypto}
              </button>
              <button
                type="button"
                className={appTab === "screener" ? "main-tab active" : "main-tab"}
                onClick={() => setAppTab("screener")}
              >
                {ko.app.tabScreener}
              </button>
              <button
                type="button"
                className={
                  appTab === "recommendations" ? "main-tab active" : "main-tab"
                }
                onClick={() => setAppTab("recommendations")}
              >
                {ko.app.tabRecommendations}
              </button>
            </nav>

            <div className="top-bar__tools">
              <button
                type="button"
                className="btn btn--secondary top-bar__rescan"
                disabled={
                  appTab !== "screener" || rescanning || picks?.running
                }
                onClick={handleRescan}
              >
                {rescanning ? ko.app.rescanning : ko.app.rescan}
              </button>
            </div>
          </div>
        </div>
      </header>
      </div>

      {picksError && !/npm\s+run\s+dev/i.test(picksError) ? (
        <div className="alert alert--error" role="alert">
          <span>{picksError}</span>
          <button type="button" className="btn btn--ghost" onClick={pollPicks}>
            {ko.app.retry}
          </button>
        </div>
      ) : null}

      {appTab === "screener" && (
        <section className="filter-bar card">
          <SignalFilter
            selected={signalFilters}
            mode={filterMode}
            onChange={setSignalFilters}
            onModeChange={setFilterMode}
          />
        </section>
      )}

      {appTab === "crypto" ? (
        <CryptoTab
          colorMode={colorMode}
          focusSymbol={cryptoFocusSymbol}
          onFocusSymbolConsumed={handleCryptoFocusConsumed}
        />
      ) : appTab === "recommendations" ? (
        <RecommendationsTab onOpenPick={handleSelect} />
      ) : appTab === "liveTrading" ? (
        <div className="live-trade-tab-root">
          <LiveTradingTab
            hideCardDock={showLiveTradeDockPortals}
            onOpenRecommendations={() => setAppTab("recommendations")}
            onOpenHoldingChart={handleLiveTradeChart}
            adminView={liveTradeAdminView}
            onClearAdminView={() => setLiveTradeAdminView(null)}
            adminIpBypass={adminIpConsole}
          />
        </div>
      ) : appTab === "ops" ? (
        <div className="workspace ops-workspace">
          <section
            className="ops-management-wrap card ops-management-main"
            aria-label={ko.app.opsPanelTitle}
          >
            <OpsManagementTab available={opsCursorAgentAvailable} />
          </section>
        </div>
      ) : (
        <div className="workspace">
        <aside className="picks-panel card">
          <div
            className={[
              "panel-head",
              appTab === "stockLookup" && lookupHotToolbar.visible
                ? "panel-head--lookup-hot"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={[
                "panel-head__filters",
                appTab === "stockLookup" && lookupHotToolbar.visible
                  ? "panel-head__filters--lookup-hot"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="market-tabs">
                <button
                  type="button"
                  className={
                    (appTab === "stockLookup" ? lookupMarketTab : screenerMarketTab) ===
                    "kr"
                      ? "market-tab active"
                      : "market-tab"
                  }
                  onClick={() => {
                    if (appTab === "stockLookup") {
                      if (lookupMarketTab !== "kr") {
                        resetStockLookupSession();
                        setLookupSearchTabMountKey((k) => k + 1);
                        setLookupMarketTab("kr");
                      }
                      return;
                    }
                    setScreenerMarketTab("kr");
                  }}
                >
                  {ko.app.marketKr}
                  {appTab === "screener" && (
                    <span className="market-tab__count">{krFiltered.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  className={
                    (appTab === "stockLookup" ? lookupMarketTab : screenerMarketTab) ===
                    "us"
                      ? "market-tab active"
                      : "market-tab"
                  }
                  onClick={() => {
                    if (appTab === "stockLookup") {
                      if (lookupMarketTab !== "us") {
                        resetStockLookupSession();
                        setLookupSearchTabMountKey((k) => k + 1);
                        setLookupMarketTab("us");
                      }
                      return;
                    }
                    setScreenerMarketTab("us");
                  }}
                >
                  {ko.app.marketUs}
                  {appTab === "screener" && (
                    <span className="market-tab__count">{usFiltered.length}</span>
                  )}
                </button>
                {appTab === "screener" ? (
                  <button
                    type="button"
                    className={
                      screenerMarketTab === "crypto"
                        ? "market-tab active"
                        : "market-tab"
                    }
                    onClick={() => setScreenerMarketTab("crypto")}
                  >
                    {ko.app.liveTradeMarketCrypto}
                    <span className="market-tab__count">{cryptoFiltered.length}</span>
                  </button>
                ) : null}
              </div>
            </div>
            {appTab === "stockLookup" && lookupHotToolbar.showUsToggle ? (
              <div className="panel-head__tail panel-head__tail--lookup-hot">
                <span
                  className="stock-search-tab__tab-hot-inline"
                  title={
                    usQuoteInKrw
                      ? usdKrwValDate
                        ? ko.app.quoteCurrencyFxBasis.replace(
                            "{date}",
                            usdKrwValDate,
                          )
                        : ko.app.quoteCurrencyShowUsd
                      : ko.app.quoteCurrencyShowKrw
                  }
                >
                  <span className="stock-search-tab__quote-currency-text">
                    {usQuoteInKrw ? "원화" : "$"}
                  </span>
                </span>
              </div>
            ) : null}
          </div>

          {appTab === "screener" ? (
            <div className="picks-panel-stack">
              <PickToolbar
                search={searchQuery}
                onSearchChange={setSearchQuery}
                sortKey={sortKey}
                onSortChange={setSortKey}
              />

              <PickList
                market={screenerMarketTab}
                picks={listPicks}
                totalCount={rawCount}
                scanning={Boolean(picks?.running)}
                scanProgress={picks?.progress}
                scanTotal={picks?.total}
                selected={screenerSelected?.symbol ?? null}
                onSelect={handleSelect}
                onNews={handleNews}
                onReason={handleReason}
              />
            </div>
          ) : (
            <StockSearchTab
              key={lookupSearchTabMountKey}
              market={lookupMarketTab}
              seedQuery={lookupSeedQuery}
              selectedSymbol={lookupSelected?.symbol ?? null}
              onSelectPick={handleLookupSelect}
              onLookupMarketChange={setLookupMarketTab}
              onNews={handleNews}
              onReason={handleReason}
              onLookupPickPatch={handleLookupPickPatch}
              usQuoteInKrw={usQuoteInKrw}
              onToggleUsQuoteKrw={toggleUsQuoteKrw}
              usdKrwRate={usdKrwRate}
              usdKrwValDate={usdKrwValDate}
              onHotToolbarStateChange={setLookupHotToolbar}
            />
          )}
        </aside>

        <section
          ref={stockChartSectionRef}
          className="chart-section crypto-chart-section"
        >
          {!workspacePick ? (
            <div className="chart-placeholder card">
              <div className="placeholder-icon" aria-hidden>
                ?
              </div>
              <p className="placeholder-title">
                {appTab === "stockLookup"
                  ? ko.app.stockLookupSelectTitle
                  : ko.app.selectTitle}
              </p>
            </div>
          ) : (
            <>
              <div className="quote-bar card">
                <div className="quote-bar__info">
                  <h2 className="quote-bar__title-stack">
                    <span className="quote-bar__title-line">
                      {chartLoading
                        ? workspacePick.name
                        : (quote?.name ?? workspacePick.name)}
                    </span>
                    {workspacePick.market === "us" &&
                      workspacePick.nameKo &&
                      workspacePick.nameKo.trim() !==
                        (chartLoading
                          ? workspacePick.name
                          : (quote?.name ?? workspacePick.name)
                        ).trim() && (
                      <span className="quote-bar__title-ko">
                        {workspacePick.nameKo}
                      </span>
                    )}
                  </h2>
                  <div className="quote-bar__quote-row">
                    {chartLoading &&
                    (stripQuotePx ?? workspacePick.price) == null ? (
                      <span className="quote-bar__quote-loading">
                        {ko.app.quoteBarLoading}
                      </span>
                    ) : (
                      <PickQuoteStrip
                        symbol={workspacePick.symbol}
                        price={
                          (stripQuotePx ?? nativeQuotePx) ??
                          workspacePick.price
                        }
                        currency={
                          stripQuoteCur ?? workspacePick.currency
                        }
                        changePercent={
                          quote?.changePercent ??
                          workspacePick.changePercent
                        }
                        size="md"
                      />
                    )}
                    {showChartKrwToggle ? (
                      <QuoteCurrencyToggle
                        inKrw={usQuoteInKrw}
                        onToggle={toggleUsQuoteKrw}
                        fxValuationDate={usdKrwValDate}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="quote-bar__right">
                  {SHOW_PROFIT_MODEL_BUTTON ? (
                    <button
                      type="button"
                      className="btn btn--secondary quote-bar__profit-btn"
                      onClick={() => setProfitModalOpen(true)}
                    >
                      {ko.app.profitModelBtn}
                    </button>
                  ) : null}
                  {chartEngine === "app" && (
                    <div className="timeframe-seg segmented compact">
                      {CHART_TIMEFRAMES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          className={
                            timeframe === t.value ? "seg active" : "seg"
                          }
                          onClick={() => setTimeframe(t.value)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {SHOW_PROFIT_MODEL_BUTTON &&
                profitModelResult &&
                profitEntry != null && (
                <div
                  className={`profit-model-strip card profit-model-strip--${profitStripTone}`}
                >
                  <span className="profit-model-strip__label">
                    {ko.app.profitModelEntry}
                  </span>
                  <span className="profit-model-strip__value">
                    {formatPrice(
                      toDisplayMoney(profitEntry),
                      stripQuoteCur,
                    )}
                  </span>
                  {profitRow?.entryAtMs != null && profitRow.entryAtMs > 0 && (
                    <>
                      <span className="profit-model-strip__label">
                        {ko.app.profitModelStripEntryTime}
                      </span>
                      <span className="profit-model-strip__value">
                        {formatUpdatedAt(profitRow.entryAtMs)}
                      </span>
                    </>
                  )}
                  {profitRow?.exit != null && profitRow.exit > 0 && (
                    <>
                      <span className="profit-model-strip__label">
                        {ko.app.profitModelStripExit}
                      </span>
                      <span className="profit-model-strip__value">
                        {formatPrice(
                          toDisplayMoney(profitRow.exit),
                          stripQuoteCur,
                        )}
                      </span>
                    </>
                  )}
                  <span className="profit-model-strip__label">
                    {ko.app.profitModelStripCurrent}
                  </span>
                  <span className="profit-model-strip__value">
                    {formatPrice(stripQuotePx ?? nativeQuotePx, stripQuoteCur)}
                  </span>
                  <span className="profit-model-strip__label">
                    {ko.app.profitModelReturn}
                  </span>
                  <span className="profit-model-strip__value profit-model-strip__pct">
                    {formatPercent(profitModelResult.pct)}
                  </span>
                  <span className="profit-model-strip__label">
                    {ko.app.profitModelPerShare}
                  </span>
                  <span className="profit-model-strip__value">
                    {formatSignedMoney(
                      toDisplayMoney(profitModelResult.abs) ?? 0,
                      stripQuoteCur,
                    )}
                  </span>
                </div>
              )}

              <div className="chart-panel card crypto-chart-panel">
                <div className="chart-toolbar">
                  <span className="chart-toolbar__label">{tfLabel}</span>
                  {candles.length > 0 && (
                    <>
                      <span className="chart-toolbar__muted">
                        {candleCount}
                        {ko.app.candleSuffix}
                      </span>
                      {chartStale && (
                        <span className="tag tag--warn">{ko.app.cacheTag}</span>
                      )}
                    </>
                  )}
                  {chartLoading && candles.length === 0 && (
                    <span className="chart-toolbar__muted">
                      {ko.app.chartLoading}
                    </span>
                  )}
                  <div className="chart-toolbar__toggles">
                    <button
                      type="button"
                      aria-pressed={chartEngine === "tradingview"}
                      className={
                        chartEngine === "tradingview"
                          ? "chip chip--on"
                          : "chip"
                      }
                      onClick={() => setChartEngine("tradingview")}
                    >
                      {ko.crypto.chartEngineTv}
                    </button>
                    <button
                      type="button"
                      aria-pressed={chartEngine === "app"}
                      className={
                        chartEngine === "app" ? "chip chip--on" : "chip"
                      }
                      onClick={() => setChartEngine("app")}
                    >
                      {ko.crypto.chartEngineApp}
                    </button>
                    {chartEngine === "app" &&
                      !chartLoading &&
                      candles.length > 0 &&
                      (
                        [
                          ["ma", ko.app.chipMa, showMa, setShowMa],
                          ["ich", ko.app.chipIch, showIchimoku, setShowIchimoku],
                          ["vol", ko.app.chipVol, showVolume, setShowVolume],
                          ["rsi", ko.app.chipRsi, showRsi, setShowRsi],
                        ] as const
                      ).map(([key, label, on, setOn]) => (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={on}
                          className={on ? "chip chip--on" : "chip"}
                          onClick={() => setOn((v) => !v)}
                        >
                          {label}
                        </button>
                      ))}
                    {chartEngine === "app" &&
                      !chartLoading &&
                      candles.length > 0 && (
                        <ChartDrawToolbarButtons
                          className="chart-draw-toolbar--inline"
                          drawMode={chartDrawMode}
                          onDrawModeChange={setChartDrawMode}
                          onClearAll={() => chartDrawApiRef.current?.clearAll()}
                          magnetEnabled={chartDrawMagnet}
                          onMagnetChange={setChartDrawMagnet}
                        />
                      )}
                  </div>
                </div>

                <div className="crypto-chart-panel-body">
                  {chartEngine === "tradingview" && stockTvSymbol ? (
                    <TradingViewAdvancedChart
                      key={`tv-${workspacePick.symbol}-${timeframe}`}
                      tvSymbol={stockTvSymbol}
                      timeframe={timeframe}
                      displayName={quote?.name ?? workspacePick.name}
                      ariaLabel={ko.crypto.tvChartAria}
                    />
                  ) : null}

                  {chartEngine === "app" && chartLoading && (
                    <div className="overlay">
                      <div className="spinner" />
                      <p>{ko.app.chartLoading}</p>
                    </div>
                  )}
                  {chartEngine === "app" && chartError && !chartLoading && (
                    <div className="overlay error-overlay">
                      <p>{chartError}</p>
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() =>
                          loadChart(workspacePick, timeframe, true)
                        }
                      >
                        {ko.app.retry}
                      </button>
                    </div>
                  )}
                  {chartEngine === "app" &&
                    !chartLoading &&
                    !chartError &&
                    candles.length > 0 && (
                      <StockChart
                        colorMode={colorMode}
                        candles={candles}
                        dailyCandles={dailyCandles}
                        fitKey={fitKey}
                        interval={chartInterval}
                        drawingsEnabled
                        chartDrawMode={chartDrawMode}
                        onChartDrawModeChange={setChartDrawMode}
                        chartDrawMagnet={chartDrawMagnet}
                        onChartDrawMagnetChange={setChartDrawMagnet}
                        showBuiltInDrawToolbar={false}
                        registerDrawApi={registerStockDrawApi}
                        overlays={stockChartOverlays}
                        profitMarker={profitMarker}
                      />
                    )}
                  {chartEngine === "app" &&
                    !chartLoading &&
                    !chartError &&
                    candles.length === 0 && (
                      <p className="chart-empty">{ko.app.chartEmpty}</p>
                    )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      )}

      {newsPick && (
        <NewsModal
          key={newsPick.symbol}
          pick={newsPick}
          items={newsItems}
          loading={newsLoading}
          error={newsError}
          onClose={closeNews}
        />
      )}

      <PicksHistoryModal
        open={picksHistoryOpen}
        onClose={() => setPicksHistoryOpen(false)}
      />

      {reasonPick && (
        <BullishReasonModal
          pick={reasonPick}
          onClose={() => setReasonPick(null)}
        />
      )}

      {showScreenFailures && picks && (picks.failedCount ?? 0) > 0 && (
        <ScreenFailuresModal
          failures={picks.failures ?? []}
          onClose={() => setShowScreenFailures(false)}
        />
      )}

      {showTelegramSent && telegramNotify && (
        <TelegramSentModal
          items={telegramSentItems}
          loading={telegramSentLoading}
          error={telegramSentError}
          onClose={() => setShowTelegramSent(false)}
          onOpenStock={(item) => {
            setShowTelegramSent(false);
            if (item.market === "crypto") {
              setAppTab("crypto");
              setCryptoFocusSymbol(item.symbol.trim());
              return;
            }
            const pick: StockPick = {
              symbol: item.symbol,
              name: item.name,
              market: item.market,
              score: item.score,
              signals: [],
            };
            skipLookupResetRef.current = true;
            setLookupSeedQuery(item.symbol);
            setLookupSelected(pick);
            setLookupMarketTab(pick.market);
            setAppTab("stockLookup");
          }}
        />
      )}

      {SHOW_PROFIT_MODEL_BUTTON && profitModalOpen && workspacePick && (
        <ProfitModelModal
          open={profitModalOpen}
          browserUserId={browserUserId}
          currentPrice={(stripQuotePx ?? nativeQuotePx) ?? workspacePick.price}
          currency={stripQuoteCur ?? workspacePick.currency}
          entry={profitEntry}
          entryAtMs={profitRow?.entryAtMs ?? null}
          exit={profitRow?.exit ?? null}
          onClose={() => setProfitModalOpen(false)}
          onApply={(n, entryAtMs) => {
            persistProfitEntry(workspacePick.symbol, n, { entryAtMs });
            setProfitPersistTick((x) => x + 1);
          }}
          onClear={() => {
            persistProfitEntry(workspacePick.symbol, null);
            setProfitPersistTick((x) => x + 1);
            setProfitModalOpen(false);
          }}
          onRecordSell={() => {
            if (
              nativeQuotePx == null ||
              !Number.isFinite(nativeQuotePx) ||
              nativeQuotePx <= 0
            ) {
              return;
            }
            persistProfitSell(workspacePick.symbol, nativeQuotePx);
            setProfitPersistTick((x) => x + 1);
          }}
        />
      )}

      <AccessAdminModal
        open={showAccessAdmin}
        onViewLiveTradePortfolio={(p) => openAdminLiveTradeView(p)}
        onViewLiveTradeTab={(p) => openAdminLiveTradeView(p)}
        onClose={() => {
          setShowAccessAdmin(false);
          void fetchConfig()
            .then((cfg) => {
              setAccessAdmin(cfg.accessAdmin ?? false);
              setAdminIpConsole(cfg.adminIpConsole ?? false);
              setOpsCursorAgentAvailable(cfg.opsCursorAgentAvailable ?? false);
            })
            .catch(() => {});
        }}
        adminIpBypassPassword={adminIpConsole}
        telegramNotify={telegramNotify}
        telegramSentCount={telegramSentCount}
        onOpenTelegramSent={() => {
          setShowAccessAdmin(false);
          void handleOpenTelegramSent();
        }}
        onResetTelegram={() => void handleResetTelegramSent()}
        resettingTelegram={resettingTelegram}
      />

      <FeedbackCorner
        ref={feedbackRef}
        accessAdmin={accessAdmin}
        onSubmitPanelChange={(state) =>
          setFooterFeedbackKind(state?.kind ?? null)
        }
      />
      </div>
      </div>
      <div
        className={
          showDesktopSideDock
            ? "app__right-panel app__right-panel--dock"
            : "app__right-panel"
        }
        aria-hidden={showDesktopSideDock ? undefined : true}
      >
        {showDesktopSideDock ? (
          <>
            <AppRightDockRailPanels
              onOpenLiveTrading={() => setAppTab("liveTrading")}
            />
            <AppLiveTradeSideDock
              feedbackRef={feedbackRef}
              feedbackActive={footerFeedbackKind != null}
              portalSource={
                showLiveTradeDockPortals ? (
                  <LiveTradingTab
                    portalSourceOnly
                    onOpenRecommendations={() => setAppTab("recommendations")}
                    onOpenHoldingChart={handleLiveTradeChart}
                    adminView={liveTradeAdminView}
                    onClearAdminView={() => setLiveTradeAdminView(null)}
                    adminIpBypass={adminIpConsole}
                  />
                ) : null
              }
            />
          </>
        ) : null}
      </div>
      </div>

      <AppSiteFooter
        accessAdmin={accessAdmin}
        appTab={appTab}
        onOpenOps={() => setAppTab("ops")}
        feedbackRef={feedbackRef}
        feedbackOpenKind={footerFeedbackKind}
        hideFeedbackLink={desktopDockLayout}
      />
      </div>
    </div>
    </LiveTradeCardSidePanelProvider>
  );
}
