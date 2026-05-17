import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChartDrawMagnet } from "./hooks/useChartDrawMagnet";
import {
  clearStoredAccessAdminToken,
  fetchConfig,
  fetchAccessStatus,
  fetchNews,
  fetchPicks,
  fetchStock,
  fetchTelegramSent,
  refreshPicks,
  resetTelegramAlertHistory,
} from "./api";
import BullishReasonModal from "./components/BullishReasonModal";
import AccessAdminModal from "./components/AccessAdminModal";
import FeedbackCorner from "./components/FeedbackCorner";
import MacroEventsBar from "./components/MacroEventsBar";
import NewsModal from "./components/NewsModal";
import ProfitModelModal from "./components/ProfitModelModal";
import ScreenFailuresModal from "./components/ScreenFailuresModal";
import TelegramSentModal from "./components/TelegramSentModal";
import PickList from "./components/PickList";
import PickQuoteStrip from "./components/PickQuoteStrip";
import PickToolbar from "./components/PickToolbar";
import SignalFilter from "./components/SignalFilter";
import type { ChartDrawMode, ChartDrawToolbarApi } from "./chartDrawTypes";
import ChartDrawToolbarButtons from "./components/ChartDrawToolbarButtons";
import CryptoTab from "./components/CryptoTab";
import StockChart from "./components/StockChart";
import TradingViewAdvancedChart from "./components/TradingViewAdvancedChart";
import { CHART_TIMEFRAMES } from "./constants/timeframes";
import type { SignalId } from "./constants/signals";
import { SHOW_PROFIT_MODEL_BUTTON } from "./constants/uiFlags";
import { usePickKeyboard } from "./hooks/usePickKeyboard";
import { enrichBullishPick } from "./lib/bullishPicks";
import {
  filterPicksBySignals,
  type FilterMode,
} from "./lib/filterPicks";
import { formatEta, formatPercent, formatPrice, formatRescanCountdown, formatSignedMoney, formatUpdatedAt, resolveNextScanAt } from "./lib/format";
import { computeProfitFromEntry } from "./lib/profitModel";
import { findChartTimeNearEntryMs } from "./lib/profitMarker";
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  type ColorMode,
} from "./lib/theme";
import {
  getBrowserUserId,
  getPersistedProfitRow,
  persistProfitEntry,
  persistProfitSell,
} from "./lib/userPersist";
import { filterPicksByQuery } from "./lib/searchPicks";
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
  TelegramSentItem,
} from "./types";

export type AppTab = "screener" | "crypto";

type StockChartEngine = "tradingview" | "app";

export default function App() {
  const [picks, setPicks] = useState<PicksResponse | null>(null);
  const [picksError, setPicksError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [telegramNotify, setTelegramNotify] = useState(false);
  const [telegramSentCount, setTelegramSentCount] = useState(0);
  const [resettingTelegram, setResettingTelegram] = useState(false);
  const [appTab, setAppTab] = useState<AppTab>("screener");
  const [colorMode, setColorMode] = useState<ColorMode>(() => readStoredTheme());
  const [marketTab, setMarketTab] = useState<Market>("kr");
  const [cryptoFocusSymbol, setCryptoFocusSymbol] = useState<string | null>(null);
  const [signalFilters, setSignalFilters] = useState<SignalId[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("and");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [selected, setSelected] = useState<StockPick | null>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1d");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dailyCandles, setDailyCandles] = useState<Candle[]>([]);
  const [chartInterval, setChartInterval] = useState("1d");
  const [candleCount, setCandleCount] = useState(0);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartStale, setChartStale] = useState(false);
  const [chartEngine, setChartEngine] = useState<StockChartEngine>("app");
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
  const [rescanClockMs, setRescanClockMs] = useState(() => Date.now());
  const [profitPersistTick, setProfitPersistTick] = useState(0);
  const [profitModalOpen, setProfitModalOpen] = useState(false);
  const newsReqIdRef = useRef(0);
  const newsAbortRef = useRef<AbortController | null>(null);
  const [showAccessAdmin, setShowAccessAdmin] = useState(false);
  const [adminIpConsole, setAdminIpConsole] = useState(false);
  const [accessAdmin, setAccessAdmin] = useState(false);

  const closeNews = useCallback(() => {
    newsReqIdRef.current += 1;
    newsAbortRef.current?.abort();
    newsAbortRef.current = null;
    setNewsPick(null);
    setNewsItems([]);
    setNewsError(null);
    setNewsLoading(false);
  }, []);

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
    pollPicks();
    const id = window.setInterval(pollPicks, 3000);
    return () => window.clearInterval(id);
  }, [pollPicks]);

  /** IP 허용이 해제되면 API 403 외에도 상태 폴링으로 즉시 게이트로 보낸다 */
  useEffect(() => {
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
        if (s.state !== "allowed") {
          if (intervalId != null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          clearStoredAccessAdminToken();
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
  }, []);

  useEffect(() => {
    applyTheme(colorMode);
    persistTheme(colorMode);
  }, [colorMode]);

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
    fetchConfig()
      .then((cfg) => {
        setTelegramNotify(cfg.telegramNotify?.enabled ?? false);
        setTelegramSentCount(cfg.telegramNotify?.todaySentCount ?? 0);
        setAdminIpConsole(cfg.adminIpConsole ?? false);
        setAccessAdmin(cfg.accessAdmin ?? false);
      })
      .catch(() => {
        setTelegramNotify(false);
        setAdminIpConsole(false);
        setAccessAdmin(false);
      });
  }, []);

  const browserUserId = useMemo(() => getBrowserUserId(), []);

  const krFiltered = useMemo(
    () => filterPicksBySignals(picks?.kr ?? [], signalFilters, filterMode),
    [picks?.kr, signalFilters, filterMode],
  );
  const usFiltered = useMemo(
    () => filterPicksBySignals(picks?.us ?? [], signalFilters, filterMode),
    [picks?.us, signalFilters, filterMode],
  );
  const baseListPicks = useMemo(() => {
    return marketTab === "kr" ? krFiltered : usFiltered;
  }, [marketTab, krFiltered, usFiltered]);

  const listPicks = useMemo(
    () => sortPicksList(filterPicksByQuery(baseListPicks, searchQuery), sortKey),
    [baseListPicks, searchQuery, sortKey],
  );

  const rawCount =
    marketTab === "kr" ? (picks?.kr.length ?? 0) : (picks?.us.length ?? 0);

  const filteredCount = baseListPicks.length;

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

  const handleSelect = useCallback((pick: StockPick) => {
    setAppTab("screener");
    setSelected(pick);
    setMarketTab(pick.market);
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
    if (!sym || (mkt !== "kr" && mkt !== "us")) {
      deepLinkHandledRef.current = null;
      return;
    }
    const key = `${mkt}:${sym}`;
    if (deepLinkHandledRef.current === key) return;
    const all = [...(picks.kr ?? []), ...(picks.us ?? [])];
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

  usePickKeyboard(
    listPicks,
    selected?.symbol ?? null,
    handleSelect,
    appTab !== "crypto" &&
      listPicks.length > 0 &&
      !newsPick &&
      !reasonPick &&
      !showScreenFailures &&
      !showTelegramSent &&
      !profitModalOpen &&
      !showAccessAdmin,
  );

  useEffect(() => {
    setProfitModalOpen(false);
    setProfitPersistTick((t) => t + 1);
  }, [selected?.symbol]);

  const loadChart = useCallback(
    async (pick: StockPick, tf: ChartTimeframe, live = false) => {
      if (!live) setChartLoading(true);
      setChartError(null);
      try {
        const data = await fetchStock(pick.symbol, tf, live);
        setQuote(data.quote);
        setCandles(data.candles);
        setDailyCandles(
          tf === "1d" ? data.candles : (data.dailyCandles ?? []),
        );
        setChartInterval(data.interval ?? tf);
        setCandleCount(data.candleCount ?? data.candles.length);
        setChartStale(Boolean(data.stale));
      } catch (err) {
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
        setChartLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selected || appTab === "crypto") return;
    loadChart(selected, timeframe);
    const refreshMs = timeframe === "1m" ? 1_000 : 30_000;
    const id = window.setInterval(() => loadChart(selected, timeframe, true), refreshMs);
    return () => window.clearInterval(id);
  }, [selected, timeframe, loadChart, appTab]);

  const handleReason = useCallback((pick: StockPick) => {
    closeNews();
    setReasonPick(
      pick.bullishReasons?.length ? pick : enrichBullishPick(pick),
    );
  }, [closeNews]);

  async function handleRescan() {
    setRescanning(true);
    try {
      await refreshPicks();
      await pollPicks();
    } catch {
      /* poll shows state */
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
  const fitKey = selected ? `${selected.symbol}:${timeframe}` : "";
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
      selected
        ? yahooStockSymbolToTradingView(selected.symbol, selected.market)
        : "",
    [selected],
  );

  useEffect(() => {
    setChartDrawMode("cursor");
  }, [selected?.symbol, timeframe, chartInterval]);

  useEffect(() => {
    if (chartEngine === "tradingview") setChartDrawMode("cursor");
  }, [chartEngine]);
  const quotePx = quote?.price ?? selected?.price;
  const quoteCur = quote?.currency ?? selected?.currency;
  const profitRow = useMemo(
    () => (selected ? getPersistedProfitRow(selected.symbol) : null),
    [selected?.symbol, profitPersistTick],
  );
  const profitEntry = profitRow?.entry ?? null;
  const profitModelResult = useMemo(
    () => computeProfitFromEntry(quotePx, profitEntry, profitRow?.exit),
    [quotePx, profitEntry, profitRow?.exit],
  );
  const profitMarker = useMemo(() => {
    if (!selected || profitEntry == null || !(profitEntry > 0)) return null;
    const ms = profitRow?.entryAtMs;
    if (!ms || candles.length === 0) return null;
    const t = findChartTimeNearEntryMs(ms, candles);
    if (!t) return null;
    return { time: t, price: profitEntry };
  }, [selected?.symbol, profitEntry, profitRow?.entryAtMs, candles]);
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
  const showTopScanStrip = Boolean(picks && appTab !== "crypto");

  return (
    <div className="app">
      <MacroEventsBar onSecretAdminOpen={() => setShowAccessAdmin(true)} />
      <FeedbackCorner accessAdmin={accessAdmin} />
      <header
        className={`top-bar card${showTopScanStrip ? " top-bar--with-scan" : ""}`}
      >
        <div
          className={`top-bar__grid${showTopScanStrip ? " top-bar__grid--with-scan" : ""}`}
        >
          <div className="top-bar__brand">
            <span className="brand-mark" aria-hidden />
            <div>
              <h1>{ko.app.title}</h1>
              <p>
                {ko.app.subtitle}
                {telegramNotify && (
                  <span className="tag-group">
                    <button
                      type="button"
                      className="tag tag--telegram tag--telegram-btn"
                      title={ko.app.telegramListAria}
                      aria-label={ko.app.telegramListAria}
                      onClick={handleOpenTelegramSent}
                    >
                      {ko.app.telegram}
                      {telegramSentCount > 0 && (
                        <span className="tag-count">{telegramSentCount}</span>
                      )}
                    </button>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="top-bar__right">
            <nav className="main-tabs" aria-label={ko.app.mainNav}>
              <button
                type="button"
                className={appTab === "screener" ? "main-tab active" : "main-tab"}
                onClick={() => setAppTab("screener")}
              >
                {ko.app.tabScreener}
              </button>
              <button
                type="button"
                className={appTab === "crypto" ? "main-tab active" : "main-tab"}
                onClick={() => setAppTab("crypto")}
              >
                {ko.app.tabCrypto}
              </button>
            </nav>

            <div className="top-bar__tools">
              {adminIpConsole && (
                <button
                  type="button"
                  className="btn btn--secondary top-bar__admin"
                  onClick={() => setShowAccessAdmin(true)}
                >
                  {ko.access.adminToolbarBtn}
                </button>
              )}
              <button
                type="button"
                className="theme-toggle"
                onClick={() =>
                  setColorMode((m) => (m === "dark" ? "light" : "dark"))
                }
                title={
                  colorMode === "dark" ? ko.app.themeUseLight : ko.app.themeUseDark
                }
                aria-label={ko.app.themeToggleAria}
                aria-pressed={colorMode === "light"}
              >
                {colorMode === "dark" ? "\u2600" : "\u263E"}
              </button>
              <button
                type="button"
                className="btn btn--secondary top-bar__rescan"
                disabled={appTab === "crypto" || rescanning || picks?.running}
                onClick={handleRescan}
              >
                {rescanning ? ko.app.rescanning : ko.app.rescan}
              </button>
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
        </div>
      </header>

      {picksError && (
        <div className="alert alert--error" role="alert">
          <span>{picksError}</span>
          <button type="button" className="btn btn--ghost" onClick={pollPicks}>
            {ko.app.retry}
          </button>
        </div>
      )}

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
          focusSymbol={cryptoFocusSymbol}
          onFocusSymbolConsumed={handleCryptoFocusConsumed}
        />
      ) : (
        <div className="workspace">
        <aside className="picks-panel card">
          <div className="panel-head">
            <div className="market-tabs">
              <button
                type="button"
                className={marketTab === "kr" ? "market-tab active" : "market-tab"}
                onClick={() => setMarketTab("kr")}
              >
                {ko.app.marketKr}
                <span className="market-tab__count">{krFiltered.length}</span>
              </button>
              <button
                type="button"
                className={marketTab === "us" ? "market-tab active" : "market-tab"}
                onClick={() => setMarketTab("us")}
              >
                {ko.app.marketUs}
                <span className="market-tab__count">{usFiltered.length}</span>
              </button>
            </div>
            <span className="panel-head__meta">
              {filteredCount} / {rawCount}
            </span>
          </div>

          <PickToolbar
            search={searchQuery}
            onSearchChange={setSearchQuery}
            sortKey={sortKey}
            onSortChange={setSortKey}
          />

          <PickList
            market={marketTab}
            picks={listPicks}
            totalCount={rawCount}
            selected={selected?.symbol ?? null}
            onSelect={handleSelect}
            onNews={handleNews}
            onReason={handleReason}
          />
        </aside>

        <section className="chart-section crypto-chart-section">
          {!selected ? (
            <div className="chart-placeholder card">
              <div className="placeholder-icon" aria-hidden>
                ?
              </div>
              <p className="placeholder-title">{ko.app.selectTitle}</p>
              <p className="placeholder-desc">{ko.app.selectDesc}</p>
            </div>
          ) : (
            <>
              <div className="quote-bar card">
                <div className="quote-bar__info">
                  <h2>{quote?.name ?? selected.name}</h2>
                  <PickQuoteStrip
                    symbol={selected.symbol}
                    price={quote?.price ?? selected.price}
                    currency={quote?.currency ?? selected.currency}
                    changePercent={
                      quote?.changePercent ?? selected.changePercent
                    }
                    size="md"
                  />
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
                    {formatPrice(profitEntry, quoteCur)}
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
                        {formatPrice(profitRow.exit, quoteCur)}
                      </span>
                    </>
                  )}
                  <span className="profit-model-strip__label">
                    {ko.app.profitModelStripCurrent}
                  </span>
                  <span className="profit-model-strip__value">
                    {formatPrice(quotePx, quoteCur)}
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
                    {formatSignedMoney(profitModelResult.abs, quoteCur)}
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
                      key={`tv-${selected.symbol}-${timeframe}`}
                      tvSymbol={stockTvSymbol}
                      timeframe={timeframe}
                      displayName={quote?.name ?? selected.name}
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
                        onClick={() => loadChart(selected, timeframe, true)}
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
            handleSelect(pick);
          }}
        />
      )}

      {SHOW_PROFIT_MODEL_BUTTON && profitModalOpen && selected && (
        <ProfitModelModal
          open={profitModalOpen}
          browserUserId={browserUserId}
          currentPrice={quotePx}
          currency={quoteCur}
          entry={profitEntry}
          entryAtMs={profitRow?.entryAtMs ?? null}
          exit={profitRow?.exit ?? null}
          onClose={() => setProfitModalOpen(false)}
          onApply={(n, entryAtMs) => {
            persistProfitEntry(selected.symbol, n, { entryAtMs });
            setProfitPersistTick((x) => x + 1);
          }}
          onClear={() => {
            persistProfitEntry(selected.symbol, null);
            setProfitPersistTick((x) => x + 1);
            setProfitModalOpen(false);
          }}
          onRecordSell={() => {
            if (quotePx == null || !Number.isFinite(quotePx) || quotePx <= 0) {
              return;
            }
            persistProfitSell(selected.symbol, quotePx);
            setProfitPersistTick((x) => x + 1);
          }}
        />
      )}

      <AccessAdminModal
        open={showAccessAdmin}
        onClose={() => {
          setShowAccessAdmin(false);
          void fetchConfig()
            .then((cfg) => {
              setAccessAdmin(cfg.accessAdmin ?? false);
              setAdminIpConsole(cfg.adminIpConsole ?? false);
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
    </div>
  );
}
