import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
  startTransition,
} from "react";
import FavoriteTrackPanel from "./FavoriteTrackPanel";
import IndustryFilterPanel from "./IndustryFilterPanel";
import {
  fetchGoldenCrossHistory,
  fetchGoldenCrossStatus,
  fetchMa120NearHistory,
  fetchMaAlignHistory,
  fetchStockVaultChartInsights,
  fetchStockVaultQuotes,
  removeStockVaultItem,
  setStockVaultFavorite,
  triggerGoldenCrossScan,
} from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import {
  goldenCrossRecencyClass,
} from "../lib/goldenCrossRecency";
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import {
  buildVaultDisplayRows,
  countItemsByScanSource,
  STOCK_VAULT_SCAN_SOURCES,
  visibleStockVaultScanSources,
  type VaultDisplayRow,
} from "../lib/stockVaultFilter";
import { kstTodayYmd } from "../lib/kstDate";
import {
  buildFullSnapshotFromScanHistory,
  mergeScanHistoryDates,
} from "../lib/stockVaultHistory";
import {
  extractScanItemsFromVault,
  listLocalScanSnapshotDates,
  mergeLocalScanSnapshot,
  mergeScanItemsIntoSnapshot,
  peekLocalScanSnapshot,
  saveLocalScanSnapshot,
} from "../lib/stockVaultLocalSnapshot";
import {
  STOCK_VAULT_TIMEFRAMES,
  stockVaultTimeframeBadgeClass,
  stockVaultTimeframeLabel,
  stockVaultTimeframeRowClass,
} from "../lib/stockVaultTimeframe";
import { industryGridDimensions } from "../lib/industryGridLayout";
import {
  VAULT_CHART_INSIGHT_SYMBOL_BATCH,
  VAULT_LIST_INITIAL_ROWS,
  VAULT_LIST_ROW_STEP,
  pickQuoteBatch,
  pruneSymbolRecord,
  uniqueVaultSymbols,
} from "../lib/stockVaultMemory";
import {
  defaultStockVaultTabUi,
  peekStockVaultTabUi,
  saveStockVaultTabUi,
  shouldShowVaultLoginHint,
  markVaultLoginHintShown,
  clearVaultLoginHintFlag,
  type Ma120ApproachFilter,
} from "../lib/stockVaultTabSession";
import {
  isStockVaultSessionPinned,
  loadStockVault,
  peekStockVaultPrefetch,
  refreshStockVaultTab,
  subscribeStockVaultPrefetch,
  updateStockVaultPrefetchVault,
} from "../lib/tabPrefetch";
import { yahooStockSymbolToTradingView } from "../lib/tradingviewSymbols";
import {
  enrichMa120ItemSide,
  formatGoldenCrossChain,
  formatMa120NearLabel,
  formatMaAlignChain,
  listMa120SymbolsNeedingQuotes,
  resolveMa120Approach,
} from "../lib/stockVaultMaDisplay";
import type {
  StockVaultFavoriteMeta,
  StockVaultItem,
  StockVaultResponse,
  StockVaultChartInsightSnapshot,
  StockVaultScanSource,
  StockVaultScanStatus,
  StockVaultTimeframe,
} from "../types";
import { VaultBookmarkIcon } from "./StockVaultMarkButton";
import {
  StockVaultRowBubblePortal,
  type StockVaultRowBubbleActions,
} from "./StockVaultRowBubble";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";

const SCAN_SOURCE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.tabGolden,
  ma_align: ko.stockVault.tabMaAlign,
  ma120_near: ko.stockVault.tabMa120Near,
  bottom_candle: ko.stockVault.tabBottomCandle,
};

const SOURCE_BADGE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.sourceGolden,
  ma_align: ko.stockVault.sourceMaAlign,
  ma120_near: ko.stockVault.sourceMa120Near,
  bottom_candle: ko.stockVault.sourceBottomCandle,
};

const SCAN_POLL_MS = 2500;
const QUOTE_POLL_MS = 60_000;
const MA120_APPROACH_QUOTE_POLL_MS = 15_000;
const CHART_INSIGHTS_POLL_MS = 120_000;

function mergeChartInsightMaps(
  prev: Record<string, StockVaultChartInsightSnapshot>,
  incoming: Record<string, StockVaultChartInsightSnapshot> | undefined,
  keepSymbols?: Iterable<string>,
) {
  const next = incoming ?? {};
  const keys = Object.keys(next);
  if (!keys.length) return prev;
  let merged = prev;
  let changed = false;
  for (const sym of keys) {
    if (prev[sym] !== next[sym]) {
      if (!changed) {
        merged = { ...prev };
        changed = true;
      }
      merged[sym] = next[sym]!;
    }
  }
  if (keepSymbols) {
    return pruneSymbolRecord(merged, keepSymbols);
  }
  return merged;
}

function usePageVisible() {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible",
  );
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

function fmtDate(ms: number): string {
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

function scanHintFromState(
  label: string,
  state: {
    krLastScanDate: string | null;
    usLastScanDate: string | null;
    krWeeklyLastScanDate?: string | null;
    usWeeklyLastScanDate?: string | null;
  },
) {
  const fmt = (
    tfLabel: string,
    kr: string | null | undefined,
    us: string | null | undefined,
  ) => {
    if (!kr && !us) return null;
    const dates = [kr ? `국내 ${kr}` : null, us ? `미국 ${us}` : null]
      .filter(Boolean)
      .join(" · ");
    return `${tfLabel} ${dates}`;
  };
  const parts = [
    fmt(`${label} 일봉`, state.krLastScanDate, state.usLastScanDate),
    fmt(
      `${label} 주봉`,
      state.krWeeklyLastScanDate,
      state.usWeeklyLastScanDate,
    ),
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : null;
}

function scanHintFromStatus(status: StockVaultScanStatus | null | undefined) {
  if (!status) return null;
  const gcState = status.goldenCross?.state ?? status.state;
  const maState = status.maAlign?.state ?? status.state;
  const ma120State = status.ma120Near?.state;
  if (!gcState || !maState) return null;
  const parts = [
    scanHintFromState(ko.stockVault.lastScanGolden, gcState),
    scanHintFromState(ko.stockVault.lastScanMaAlign, maState),
    ma120State
      ? scanHintFromState(ko.stockVault.lastScanMa120Near, ma120State)
      : null,
    status.bottomCandle?.state
      ? scanHintFromState(ko.stockVault.lastScanBottomCandle, status.bottomCandle.state)
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function favoriteVaultSymbols(vault: Pick<StockVaultResponse, "favoriteSymbols" | "items">) {
  if (vault.favoriteSymbols?.length) {
    return vault.favoriteSymbols.map((s) => s.trim().toUpperCase());
  }
  return (vault.items ?? [])
    .filter((it) => it.favorited || it.source === "favorite")
    .map((it) => it.symbol.trim().toUpperCase());
}

function rowIndustry(meta: StockVaultResponse["meta"], row: VaultDisplayRow) {
  const symKey = row.symbol.trim().toUpperCase();
  return meta?.[symKey]?.industry?.trim() || "기타";
}
type VaultFilter = "all" | "favorite";

function rowFavoriteTrack(row: VaultDisplayRow) {
  const src = row.favorite ?? row.goldenCross ?? row.maAlign ?? row.ma120Near ?? row.bottomCandle;
  return {
    addedAtMs: src?.favoriteAddedAtMs ?? src?.addedAtMs ?? null,
    favoritePrice: src?.favoritePrice ?? null,
  };
}

function vaultStateFromResponse(vault: StockVaultResponse) {
  return {
    items: vault.items ?? [],
    quotes: vault.quotes ?? {},
    meta: vault.meta ?? {},
    chartInsights:
      vault.chartInsights ??
      (vault.weeklyMaProximity
        ? Object.fromEntries(
            Object.entries(vault.weeklyMaProximity).map(([sym, row]) => [
              sym,
              {
                daily: { trend: "neutral" as const, near: [] },
                weekly: { trend: "neutral" as const, near: row.near ?? [] },
                updatedAtMs: row.updatedAtMs,
              },
            ]),
          )
        : {}),
    authenticated: Boolean(vault.authenticated),
    favoriteMeta: vault.favoriteMeta ?? {},
    industryTabs: vault.industryTabs?.length ? vault.industryTabs : [],
  };
}

export default function StockVaultTab({
  onVaultChange,
}: {
  onVaultChange?: (
    symbols: string[],
    favoriteMeta?: Record<string, StockVaultFavoriteMeta>,
  ) => void;
}) {
  const cachedInit = peekStockVaultPrefetch();
  const cachedVault = cachedInit ? vaultStateFromResponse(cachedInit.vault) : null;
  const uiInit = peekStockVaultTabUi() ?? defaultStockVaultTabUi();
  const { user, authChecked, refreshAuth } = useLiveTradeAuth();
  const vaultAuthSyncedRef = useRef(false);
  const loginHintTimerRef = useRef<number | null>(null);

  const [items, setItems] = useState<StockVaultItem[]>(() => cachedVault?.items ?? []);
  const [quotes, setQuotes] = useState<
    Record<string, { price: number; changePercent?: number; currency?: string }>
  >(() => cachedVault?.quotes ?? {});
  const [meta, setMeta] = useState<
    Record<
      string,
      {
        industry?: string | null;
        nameKo?: string | null;
        tvSymbol?: string | null;
        exchange?: string | null;
      }
    >
  >(() => cachedVault?.meta ?? {});
  const [chartInsights, setChartInsights] = useState<
    Record<string, StockVaultChartInsightSnapshot>
  >(() => cachedVault?.chartInsights ?? {});
  const [industryTabs, setIndustryTabs] = useState<string[]>(
    () => cachedVault?.industryTabs ?? [],
  );
  const [loading, setLoading] = useState(
    () => {
      const hasLocalToday = Boolean(peekLocalScanSnapshot(kstTodayYmd())?.length);
      return (
        !cachedInit &&
        !(cachedVault?.items?.length) &&
        !isStockVaultSessionPinned() &&
        !hasLocalToday &&
        !uiInit.selectedScanDate
      );
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<VaultFilter>(() => uiInit.filter);
  const [selectedScanSources, setSelectedScanSources] = useState<
    StockVaultScanSource[]
  >(() => [...uiInit.selectedScanSources]);
  const [ma120ApproachFilter, setMa120ApproachFilter] = useState<
    Ma120ApproachFilter | null
  >(() => uiInit.ma120ApproachFilter);
  const [timeframeFilter, setTimeframeFilter] = useState<StockVaultTimeframe>(
    () => uiInit.timeframeFilter,
  );
  const [marketFilter, setMarketFilter] = useState<"all" | "kr" | "us">(
    () => uiInit.marketFilter,
  );
  const [industryFilter, setIndustryFilter] = useState<string>(
    () => uiInit.industryFilter,
  );
  const [authenticated, setAuthenticated] = useState(
    () => cachedVault?.authenticated ?? false,
  );
  const [favoriteMeta, setFavoriteMeta] = useState<
    Record<string, StockVaultFavoriteMeta>
  >(() => cachedVault?.favoriteMeta ?? {});
  const [scanHint, setScanHint] = useState<string | null>(() =>
    scanHintFromStatus(cachedInit?.scanStatus),
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [favoriting, setFavoriting] = useState<string | null>(null);
  const [scanEnabled, setScanEnabled] = useState(
    () => cachedInit?.scanStatus?.enabled ?? true,
  );
  const [scanRunning, setScanRunning] = useState(() =>
    Boolean(cachedInit?.scanStatus?.running),
  );
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [historyDates, setHistoryDates] = useState<string[]>(() => {
    const local = listLocalScanSnapshotDates();
    return local.length ? local : [];
  });
  const [selectedScanDate, setSelectedScanDate] = useState<string | null>(
    () => uiInit.selectedScanDate,
  );
  const [snapshotItems, setSnapshotItems] = useState<StockVaultItem[] | null>(() => {
    const date = uiInit.selectedScanDate ?? kstTodayYmd();
    return peekLocalScanSnapshot(date);
  });
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const scanBtnRef = useRef<HTMLButtonElement>(null);
  const scanPopoverRef = useRef<HTMLDivElement>(null);
  const quoteBatchRef = useRef(0);
  const chartInsightBatchRef = useRef(0);
  const [listVisibleCount, setListVisibleCount] = useState(VAULT_LIST_INITIAL_ROWS);
  const rowBubbleTipId = useId();
  const rowBubbleActionsRef = useRef<StockVaultRowBubbleActions | null>(null);

  const applyVaultResponse = useCallback(
    (vault: StockVaultResponse) => {
      setItems(vault.items ?? []);
      if (vault.quotes && Object.keys(vault.quotes).length) {
        setQuotes(vault.quotes);
      }
      setMeta(vault.meta ?? {});
      if (vault.chartInsights && Object.keys(vault.chartInsights).length) {
        setChartInsights((prev) =>
          mergeChartInsightMaps(prev, vault.chartInsights, vault.items?.map((it) => it.symbol)),
        );
      } else if (vault.weeklyMaProximity) {
        setChartInsights((prev) =>
          mergeChartInsightMaps(
            prev,
            Object.fromEntries(
              Object.entries(vault.weeklyMaProximity!).map(([sym, row]) => [
                sym,
                {
                  daily: { trend: "neutral" as const, near: [] },
                  weekly: { trend: "neutral" as const, near: row.near ?? [] },
                  updatedAtMs: row.updatedAtMs,
                },
              ]),
            ),
            vault.items?.map((it) => it.symbol),
          ),
        );
      }
      setAuthenticated(Boolean(vault.authenticated));
      setFavoriteMeta(vault.favoriteMeta ?? {});
      setIndustryTabs((prev) =>
        vault.industryTabs?.length ? vault.industryTabs : prev,
      );
      onVaultChange?.(favoriteVaultSymbols(vault), vault.favoriteMeta);
      updateStockVaultPrefetchVault(vault);
    },
    [onVaultChange],
  );

  const applyScanStatus = useCallback((status: StockVaultScanStatus | null | undefined) => {
    if (!status) return;
    setScanEnabled(status.enabled);
    setScanRunning(Boolean(status.running));
    setScanHint(scanHintFromStatus(status));
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!user) {
      vaultAuthSyncedRef.current = false;
      clearVaultLoginHintFlag();
      return;
    }
    if (authenticated && vaultAuthSyncedRef.current) return;
    let cancelled = false;
    void (async () => {
      await refreshAuth();
      const bundle = await refreshStockVaultTab();
      if (cancelled) return;
      applyVaultResponse(bundle.vault);
      applyScanStatus(bundle.scanStatus);
      setError((err) =>
        err === ko.stockVault.loginRequired ? null : err,
      );
      vaultAuthSyncedRef.current = true;
      clearVaultLoginHintFlag();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authChecked,
    user?.id,
    authenticated,
    refreshAuth,
    applyVaultResponse,
    applyScanStatus,
  ]);

  const ensureVaultAuthenticated = useCallback(async () => {
    if (authenticated) return true;
    const liveUser = await refreshAuth();
    if (!liveUser) return false;
    const bundle = await refreshStockVaultTab();
    applyVaultResponse(bundle.vault);
    return Boolean(bundle.vault.authenticated);
  }, [authenticated, refreshAuth, applyVaultResponse]);

  const showLoginHintOnce = useCallback(() => {
    if (!shouldShowVaultLoginHint()) return;
    markVaultLoginHintShown();
    setError(ko.stockVault.loginRequired);
    if (loginHintTimerRef.current != null) {
      window.clearTimeout(loginHintTimerRef.current);
    }
    loginHintTimerRef.current = window.setTimeout(() => {
      setError((cur) => (cur === ko.stockVault.loginRequired ? null : cur));
      loginHintTimerRef.current = null;
    }, 8000);
  }, []);

  useEffect(
    () => () => {
      if (loginHintTimerRef.current != null) {
        window.clearTimeout(loginHintTimerRef.current);
      }
    },
    [],
  );

  const seedTodaySnapshotFromVault = useCallback(
    (vault: StockVaultResponse) => {
      const today = kstTodayYmd();
      const incoming = extractScanItemsFromVault(vault.items);
      const merged = mergeLocalScanSnapshot(today, incoming);
      if (selectedScanDate == null) {
        setSnapshotItems(merged.length ? merged : incoming);
      }
    },
    [selectedScanDate],
  );

  const mergeTodaySnapshotFromVault = useCallback(
    (vault: StockVaultResponse) => {
      const today = kstTodayYmd();
      const merged = mergeLocalScanSnapshot(
        today,
        extractScanItemsFromVault(vault.items),
      );
      if (selectedScanDate == null) setSnapshotItems(merged);
    },
    [selectedScanDate],
  );

  const reload = useCallback(async (force = false) => {
    const hadData =
      !force &&
      (Boolean(peekStockVaultPrefetch()) || items.length > 0);
    if (!hadData) {
      setLoading(true);
    }
    setError(null);
    try {
      const bundle = force ? await refreshStockVaultTab() : await loadStockVault();
      applyVaultResponse(bundle.vault);
      seedTodaySnapshotFromVault(bundle.vault);
      applyScanStatus(bundle.scanStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyVaultResponse, applyScanStatus, seedTodaySnapshotFromVault, items.length]);

  useEffect(() => {
    saveStockVaultTabUi({
      filter,
      selectedScanSources,
      ma120ApproachFilter,
      timeframeFilter,
      marketFilter,
      industryFilter,
      selectedScanDate,
    });
  }, [
    filter,
    selectedScanSources,
    ma120ApproachFilter,
    timeframeFilter,
    marketFilter,
    industryFilter,
    selectedScanDate,
  ]);

  useEffect(() => {
    if (cachedInit?.vault) {
      seedTodaySnapshotFromVault(cachedInit.vault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount seed only
  }, []);

  useEffect(() => {
    if (peekStockVaultPrefetch() || isStockVaultSessionPinned()) {
      setLoading(false);
      return;
    }
    void reload();
  }, [reload]);

  const pageVisible = usePageVisible();

  const refreshHistoryDates = useCallback(async () => {
    try {
      const [gc, ma, ma120] = await Promise.all([
        fetchGoldenCrossHistory(),
        fetchMaAlignHistory(),
        fetchMa120NearHistory(),
      ]);
      const merged = mergeScanHistoryDates(gc.dates, ma.dates, ma120.dates);
      const localDates = listLocalScanSnapshotDates();
      const all = [...new Set([...merged, ...localDates])].sort((a, b) =>
        b.localeCompare(a),
      );
      setHistoryDates(all);
    } catch {
      const localDates = listLocalScanSnapshotDates();
      if (localDates.length) setHistoryDates(localDates);
    }
  }, []);

  useEffect(() => {
    void refreshHistoryDates();
  }, [refreshHistoryDates]);

  const favoriteSymbolSet = useMemo(
    () => new Set(favoriteVaultSymbols({ items, favoriteSymbols: undefined })),
    [items],
  );

  const isHistoricalView = selectedScanDate != null;

  useEffect(() => {
    const effectiveDate = selectedScanDate ?? kstTodayYmd();

    if (!selectedScanDate) {
      setSnapshotItems(peekLocalScanSnapshot(effectiveDate) ?? []);
      setSnapshotLoading(false);
      return;
    }

    const cached = peekLocalScanSnapshot(effectiveDate);
    if (cached) {
      setSnapshotItems(cached);
      setSnapshotLoading(false);
      return;
    }

    let cancelled = false;
    setSnapshotLoading(true);
    void (async () => {
      try {
        const [gc, ma, ma120] = await Promise.all([
          fetchGoldenCrossHistory({
            scanDate: effectiveDate,
            detail: true,
          }),
          fetchMaAlignHistory({
            scanDate: effectiveDate,
            detail: true,
          }),
          fetchMa120NearHistory({
            scanDate: effectiveDate,
            detail: true,
          }),
        ]);
        if (cancelled) return;
        const built = buildFullSnapshotFromScanHistory(
          effectiveDate,
          gc.entries ?? [],
          ma.entries ?? [],
          ma120.entries ?? [],
          {
            favoriteSymbols: favoriteSymbolSet,
            favoriteMeta,
          },
        );
        saveLocalScanSnapshot(effectiveDate, built);
        setSnapshotItems(built);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedScanDate, favoriteSymbolSet, favoriteMeta]);

  const displayItems = useMemo(() => {
    if (isHistoricalView) return snapshotItems ?? [];
    const snap = snapshotItems ?? [];
    const fromVault = extractScanItemsFromVault(items);
    const merged = mergeScanItemsIntoSnapshot(snap, fromVault);
    const extras = items.filter((it) => it.source === "favorite");
    return [...merged, ...extras];
  }, [snapshotItems, items, isHistoricalView]);

  const getRowIndustry = useCallback(
    (row: VaultDisplayRow) => rowIndustry(meta, row),
    [meta],
  );

  useEffect(() => {
    return subscribeStockVaultPrefetch((bundle) => {
      applyVaultResponse(bundle.vault);
      seedTodaySnapshotFromVault(bundle.vault);
      applyScanStatus(bundle.scanStatus);
      setLoading(false);
      setError(null);
    });
  }, [applyVaultResponse, applyScanStatus, seedTodaySnapshotFromVault]);

  useEffect(() => {
    if (!scanRunning) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchGoldenCrossStatus();
          applyScanStatus(status);
          if (!status.running) {
            const bundle = await refreshStockVaultTab();
            applyVaultResponse(bundle.vault);
            mergeTodaySnapshotFromVault(bundle.vault);
            applyScanStatus(bundle.scanStatus);
            void refreshHistoryDates();
            setScanNotice(ko.stockVault.scanDone);
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, SCAN_POLL_MS);
    return () => window.clearInterval(id);
  }, [scanRunning, applyScanStatus, applyVaultResponse, mergeTodaySnapshotFromVault, refreshHistoryDates]);

  useEffect(() => {
    if (!scanConfirmOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (scanBtnRef.current?.contains(t)) return;
      if (scanPopoverRef.current?.contains(t)) return;
      setScanConfirmOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [scanConfirmOpen]);

  const toggleScanSource = useCallback(
    (source: StockVaultScanSource) => {
      const maybeReload =
        (source === "ma120_near" || source === "bottom_candle") &&
        countItemsByScanSource(displayItems, source, timeframeFilter) === 0;
      startTransition(() => {
        setIndustryFilter("all");
        setSelectedScanSources((prev) => {
          const set = new Set(prev);
          if (set.has(source)) set.delete(source);
          else set.add(source);
          const next = STOCK_VAULT_SCAN_SOURCES.filter((s) => set.has(s));
          if (!next.includes("ma120_near")) {
            setMa120ApproachFilter(null);
          }
          return next;
        });
      });
      if (maybeReload) {
        void reload(true);
      }
    },
    [displayItems, timeframeFilter, reload],
  );

  useEffect(() => {
    if (timeframeFilter !== "1wk") return;
    setSelectedScanSources((prev) => {
      const next = prev.filter((s) => s !== "ma120_near");
      return next.length ? next : ["golden_cross"];
    });
    setMa120ApproachFilter(null);
  }, [timeframeFilter]);

  const selectMa120ApproachFilter = useCallback((approach: Ma120ApproachFilter) => {
    setIndustryFilter("all");
    setMa120ApproachFilter((prev) => (prev === approach ? null : approach));
  }, []);

  const ma120ApproachCounts = useMemo(() => {
    const counts = { from_below: 0, from_above: 0 };
    if (timeframeFilter !== "1d") return counts;
    for (const it of displayItems) {
      if (it.source !== "ma120_near") continue;
      if (marketFilter !== "all" && it.market !== marketFilter) continue;
      const sym = it.symbol.trim().toUpperCase();
      const approach = resolveMa120Approach(it, chartInsights[sym], quotes[sym]?.price);
      if (approach === "from_below") counts.from_below += 1;
      else if (approach === "from_above") counts.from_above += 1;
    }
    return counts;
  }, [displayItems, marketFilter, timeframeFilter, chartInsights, quotes]);

  const showMa120ApproachFilters =
    selectedScanSources.includes("ma120_near") && timeframeFilter === "1d";

  const visibleScanSources = useMemo(
    () => visibleStockVaultScanSources(timeframeFilter),
    [timeframeFilter],
  );

  const scanSourceCounts = useMemo(
    () =>
      Object.fromEntries(
        visibleScanSources.map((source) => [
          source,
          countItemsByScanSource(displayItems, source, timeframeFilter),
        ]),
      ) as Record<StockVaultScanSource, number>,
    [displayItems, timeframeFilter, visibleScanSources],
  );

  const scanRowsAllMarkets = useMemo(
    () =>
      buildVaultDisplayRows(displayItems, {
        selectedScanSources,
        marketFilter: "all",
        favoriteOnly: filter === "favorite",
        timeframeFilter,
      }),
    [displayItems, selectedScanSources, filter, timeframeFilter],
  );

  const baseFiltered = useMemo(
    () =>
      marketFilter === "all"
        ? scanRowsAllMarkets
        : scanRowsAllMarkets.filter((r) => r.market === marketFilter),
    [scanRowsAllMarkets, marketFilter],
  );

  const favoriteCount = useMemo(
    () => scanRowsAllMarkets.filter((r) => r.favorited).length,
    [scanRowsAllMarkets],
  );

  const industryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of baseFiltered) {
      const industry = getRowIndustry(row);
      if (!industry) continue;
      counts.set(industry, (counts.get(industry) ?? 0) + 1);
    }
    return industryTabs.map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    }));
  }, [baseFiltered, getRowIndustry, industryTabs]);

  const filtered = useMemo(() => {
    let rows =
      industryFilter === "all"
        ? baseFiltered
        : baseFiltered.filter((row) => getRowIndustry(row) === industryFilter);
    if (!showMa120ApproachFilters || ma120ApproachFilter == null) {
      return rows;
    }
    return rows.filter((row) => {
      if (!row.ma120Near) return false;
      const sym = row.symbol.trim().toUpperCase();
      const approach = resolveMa120Approach(
        row.ma120Near,
        chartInsights[sym],
        quotes[sym]?.price,
      );
      return ma120ApproachFilter === approach;
    });
  }, [
    baseFiltered,
    industryFilter,
    getRowIndustry,
    showMa120ApproachFilters,
    ma120ApproachFilter,
    chartInsights,
    quotes,
  ]);

  const intersectionActive =
    filter !== "favorite" && selectedScanSources.length >= 2;

  const showSelectScanCondition =
    filter !== "favorite" && selectedScanSources.length === 0;

  const showEmptyIntersection =
    intersectionActive &&
    filtered.length === 0 &&
    selectedScanSources.some((s) => scanSourceCounts[s] > 0);

  const deferredFiltered = useDeferredValue(filtered);

  useEffect(() => {
    setListVisibleCount(VAULT_LIST_INITIAL_ROWS);
  }, [
    deferredFiltered.length,
    selectedScanSources.join(","),
    marketFilter,
    industryFilter,
    timeframeFilter,
    filter,
    selectedScanDate,
  ]);

  const visibleRows = useMemo(
    () => deferredFiltered.slice(0, listVisibleCount),
    [deferredFiltered, listVisibleCount],
  );

  const hasMoreRows = visibleRows.length < deferredFiltered.length;

  const listPollSymbols = useMemo(
    () => uniqueVaultSymbols(visibleRows.map((r) => r.symbol)),
    [visibleRows],
  );

  const listPollSymbolsKey = useMemo(
    () => listPollSymbols.join(","),
    [listPollSymbols],
  );

  const needsChartInsights =
    selectedScanSources.includes("ma120_near") && timeframeFilter === "1d";

  const refreshListQuotes = useCallback(async () => {
    if (!listPollSymbols.length) return;
    const batch = pickQuoteBatch(listPollSymbols, quoteBatchRef.current);
    quoteBatchRef.current += 1;
    try {
      const res = await fetchStockVaultQuotes(batch);
      setQuotes((prev) => {
        const next = { ...prev };
        for (const [sym, q] of Object.entries(res.quotes ?? {})) {
          if (!q?.price || !Number.isFinite(q.price)) continue;
          next[sym.trim().toUpperCase()] = {
            price: q.price,
            changePercent: q.changePercent,
            currency: q.currency,
          };
        }
        return pruneSymbolRecord(next, listPollSymbols);
      });
    } catch {
      /* ignore poll errors */
    }
  }, [listPollSymbols]);

  useEffect(() => {
    if (!pageVisible || loading || scanRunning || !listPollSymbols.length) return;
    quoteBatchRef.current = 0;
    void refreshListQuotes();
    const id = window.setInterval(() => {
      void refreshListQuotes();
    }, QUOTE_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    pageVisible,
    loading,
    scanRunning,
    listPollSymbolsKey,
    refreshListQuotes,
  ]);

  useEffect(() => {
    if (!pageVisible || !needsChartInsights || !listPollSymbols.length) return;
    let cancelled = false;
    const loadInsights = async () => {
      if (document.visibilityState === "hidden") return;
      const batchIndex = chartInsightBatchRef.current;
      chartInsightBatchRef.current += 1;
      const symbols = pickQuoteBatch(
        listPollSymbols,
        batchIndex,
        VAULT_CHART_INSIGHT_SYMBOL_BATCH,
      );
      if (!symbols.length) return;
      try {
        const res = await fetchStockVaultChartInsights({ refresh: false, symbols });
        if (!cancelled && res.chartInsights) {
          setChartInsights((prev) =>
            mergeChartInsightMaps(prev, res.chartInsights, listPollSymbols),
          );
        }
      } catch {
        /* ignore */
      }
    };
    chartInsightBatchRef.current = 0;
    void loadInsights();
    const id = window.setInterval(() => {
      void loadInsights();
    }, CHART_INSIGHTS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pageVisible, needsChartInsights, listPollSymbolsKey, listPollSymbols]);

  useEffect(() => {
    if (!pageVisible || !needsChartInsights) return;
    const ma120Items = displayItems.filter((it) => it.source === "ma120_near");
    const need = listMa120SymbolsNeedingQuotes(ma120Items, quotes, chartInsights);
    if (!need.length) return;

    let cancelled = false;
    const pull = async () => {
      if (cancelled) return;
      const pending = listMa120SymbolsNeedingQuotes(ma120Items, quotes, chartInsights);
      if (!pending.length) return;
      try {
        const res = await fetchStockVaultQuotes(pending);
        if (cancelled) return;
        setQuotes((prev) => {
          const next = { ...prev };
          for (const [sym, q] of Object.entries(res.quotes ?? {})) {
            if (!q?.price || !Number.isFinite(q.price)) continue;
            next[sym.trim().toUpperCase()] = {
              price: q.price,
              changePercent: q.changePercent,
              currency: q.currency,
            };
          }
          return next;
        });
        setSnapshotItems((prev) => {
          if (!prev?.length) return prev;
          let changed = false;
          const nextItems = prev.map((it) => {
            const sym = it.symbol.trim().toUpperCase();
            const enriched = enrichMa120ItemSide(it, res.quotes?.[sym]?.price);
            if (enriched.ma120Side !== it.ma120Side) changed = true;
            return enriched;
          });
          if (!changed) return prev;
          saveLocalScanSnapshot(selectedScanDate ?? kstTodayYmd(), nextItems);
          return nextItems;
        });
      } catch {
        /* ignore */
      }
    };

    void pull();
    const id = window.setInterval(() => {
      void pull();
    }, MA120_APPROACH_QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    pageVisible,
    needsChartInsights,
    displayItems,
    chartInsights,
    quotes,
    selectedScanDate,
  ]);

  useEffect(() => {
    if (industryFilter === "all") return;
    if (!industryTabs.includes(industryFilter)) {
      setIndustryFilter("all");
    }
  }, [industryFilter, industryTabs]);

  const industryGrid = useMemo(
    () => industryGridDimensions(industryTabs.length),
    [industryTabs.length],
  );

  const marketCounts = useMemo(
    () => ({
      all: scanRowsAllMarkets.length,
      kr: scanRowsAllMarkets.filter((r) => r.market === "kr").length,
      us: scanRowsAllMarkets.filter((r) => r.market === "us").length,
    }),
    [scanRowsAllMarkets],
  );

  const handleRemove = useCallback(
    async (symbol: string) => {
      if (!(await ensureVaultAuthenticated())) {
        showLoginHintOnce();
        return;
      }
      const sym = symbol.trim().toUpperCase();
      setRemoving(sym);
      setError(null);
      try {
        await removeStockVaultItem(symbol);
        setItems((prev) => {
          const next = prev.filter((it) => it.symbol !== sym);
          onVaultChange?.(
            next
              .filter((it) => it.favorited || it.source === "favorite")
              .map((it) => it.symbol.trim().toUpperCase()),
          );
          return next;
        });
        setSnapshotItems((prev) => {
          if (!prev?.length) return prev;
          const next = prev.filter((it) => it.symbol.trim().toUpperCase() !== sym);
          saveLocalScanSnapshot(selectedScanDate ?? kstTodayYmd(), next);
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRemoving(null);
      }
    },
    [ensureVaultAuthenticated, showLoginHintOnce, onVaultChange, selectedScanDate],
  );

  const handleToggleFavorite = useCallback(
    async (symbol: string, favorited: boolean, market: "kr" | "us", name: string) => {
      if (!(await ensureVaultAuthenticated())) {
        showLoginHintOnce();
        return;
      }
      const sym = symbol.trim().toUpperCase();
      setFavoriting(sym);
      setError(null);
      try {
        const quotePrice = quotes[sym]?.price;
        const res = await setStockVaultFavorite(symbol, !favorited, {
          favoritePrice: !favorited ? quotePrice : undefined,
          market,
          name,
        });
        if (res.meta) {
          setFavoriteMeta((prev) => {
            const next = { ...prev, [sym]: res.meta! };
            onVaultChange?.(Object.keys(next), next);
            return next;
          });
        } else if (favorited) {
          setFavoriteMeta((prev) => {
            const next = { ...prev };
            delete next[sym];
            onVaultChange?.(Object.keys(next), next);
            return next;
          });
        }
        setItems((prev) => {
          const nextItems = prev.map((it) => {
            if (it.symbol.trim().toUpperCase() !== sym) return it;
            const nextFav = !favorited;
            const fields = res.meta
              ? {
                  favoriteAddedAtMs: res.meta.addedAtMs,
                  favoritePrice: res.meta.favoritePrice ?? null,
                }
              : nextFav
                ? {}
                : {
                    favoriteAddedAtMs: null,
                    favoritePrice: null,
                  };
            return { ...it, favorited: nextFav, ...fields };
          });
          return nextItems;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setFavoriting(null);
      }
    },
    [ensureVaultAuthenticated, showLoginHintOnce, quotes, onVaultChange],
  );

  const handleFavoritePriceSaved = useCallback(
    (symbol: string, price: number | null) => {
      const sym = symbol.trim().toUpperCase();
      setFavoriteMeta((prev) => {
        const row = prev[sym];
        if (!row) return prev;
        const next = {
          ...prev,
          [sym]: { ...row, favoritePrice: price, updatedAtMs: Date.now() },
        };
        onVaultChange?.(
          Object.keys(next).filter((k) => next[k]),
          next,
        );
        return next;
      });
      setItems((prev) =>
        prev.map((it) =>
          it.symbol.trim().toUpperCase() === sym
            ? { ...it, favoritePrice: price }
            : it,
        ),
      );
    },
    [onVaultChange],
  );

  const handleScanConfirm = useCallback(async () => {
    setScanConfirmOpen(false);
    setScanNotice(null);
    setError(null);
    try {
      const res = await triggerGoldenCrossScan();
      if (!res.started) {
        setScanNotice(
          res.reason === "busy"
            ? ko.stockVault.scanBusy
            : res.reason === "disabled"
              ? ko.stockVault.scanDisabled
              : res.error ?? ko.errors.request,
        );
        return;
      }
      setScanRunning(true);
      setScanNotice(ko.stockVault.scanRunning);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="workspace stock-vault-tab">
      <section className="stock-vault-tab__panel card">
        <header className="stock-vault-tab__head">
          <div className="stock-vault-tab__head-row">
            <h2 className="stock-vault-tab__title">{ko.stockVault.title}</h2>
            <div className="stock-vault-tab__head-actions">
              <div className="stock-vault-tab__scan-wrap">
                <button
                  ref={scanBtnRef}
                  type="button"
                  className="stock-vault-tab__head-btn"
                  disabled={!scanEnabled || scanRunning}
                  aria-expanded={scanConfirmOpen}
                  aria-haspopup="dialog"
                  onClick={() => setScanConfirmOpen((open) => !open)}
                >
                  {scanRunning ? ko.stockVault.scanRunning : ko.stockVault.scanRun}
                </button>
                {scanConfirmOpen ? (
                  <div
                    ref={scanPopoverRef}
                    className="stock-vault-tab__scan-popover"
                    role="dialog"
                    aria-labelledby="stock-vault-scan-popover-title"
                    onMouseDown={(ev) => ev.stopPropagation()}
                  >
                    <p
                      id="stock-vault-scan-popover-title"
                      className="stock-vault-tab__scan-popover-lead"
                    >
                      {ko.stockVault.scanConfirmLead}
                    </p>
                    <p className="stock-vault-tab__scan-popover-body">
                      {ko.stockVault.scanConfirmBody}
                    </p>
                    <div className="stock-vault-tab__scan-popover-actions">
                      <button
                        type="button"
                        className="stock-vault-tab__scan-popover-btn stock-vault-tab__scan-popover-btn--primary"
                        onClick={() => void handleScanConfirm()}
                      >
                        {ko.stockVault.scanConfirmOk}
                      </button>
                      <button
                        type="button"
                        className="stock-vault-tab__scan-popover-btn"
                        onClick={() => setScanConfirmOpen(false)}
                      >
                        {ko.stockVault.scanConfirmCancel}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="stock-vault-tab__head-btn"
                onClick={() => void reload(true)}
              >
                {ko.app.retry}
              </button>
            </div>
          </div>
          {scanHint ? (
            <p className="stock-vault-tab__scan-hint">
              {ko.stockVault.lastScan}: {scanHint}
            </p>
          ) : null}
          {historyDates.length > 0 ? (
            <label className="stock-vault-tab__history-select-wrap">
              <span className="stock-vault-tab__history-select-label">
                {ko.stockVault.historyDateAria}
              </span>
              <span className="stock-vault-tab__history-select-shell">
                <select
                  className="stock-vault-tab__history-select"
                  aria-label={ko.stockVault.historyDateAria}
                  value={selectedScanDate ?? ""}
                  onChange={(e) =>
                    setSelectedScanDate(e.target.value.trim() || null)
                  }
                >
                  <option value="">{ko.stockVault.historyLatest}</option>
                  {historyDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          ) : null}
          {isHistoricalView && selectedScanDate ? (
            <p className="stock-vault-tab__history-hint">
              {ko.stockVault.historyViewHint(selectedScanDate)}
            </p>
          ) : null}
          {scanNotice ? (
            <p className="stock-vault-tab__scan-notice">{scanNotice}</p>
          ) : null}
        </header>

        <div className="stock-vault-tab__filters-wrap">
          <div
            className="stock-vault-tab__filters stock-vault-tab__filters--timeframe"
            role="tablist"
            aria-label={ko.stockVault.timeframeFilterAria}
          >
            <div className="market-tabs">
              {STOCK_VAULT_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  role="tab"
                  data-tf={tf}
                  aria-selected={timeframeFilter === tf}
                  className={[
                    "market-tab",
                    "stock-vault-tab__tf-tab",
                    tf === "1wk"
                      ? "stock-vault-tab__tf-tab--wk"
                      : "stock-vault-tab__tf-tab--d",
                    timeframeFilter === tf ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setIndustryFilter("all");
                    setTimeframeFilter(tf);
                  }}
                >
                  {stockVaultTimeframeLabel(tf)}
                </button>
              ))}
            </div>
          </div>

          <div
            className="stock-vault-tab__filters stock-vault-tab__filters--kind"
            role="group"
            aria-label={ko.stockVault.scanConditionAria}
          >
            <div className="market-tabs market-tabs--vault-scan">
              {visibleScanSources.map((source) => {
                const active = selectedScanSources.includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    className={
                      active
                        ? "market-tab market-tab--toggle active"
                        : "market-tab market-tab--toggle"
                    }
                    aria-pressed={active}
                    onClick={() => toggleScanSource(source)}
                  >
                    {SCAN_SOURCE_LABEL[source]}
                    <span className="market-tab__count">{scanSourceCounts[source]}</span>
                  </button>
                );
              })}
            </div>
            {intersectionActive ? (
              <p className="stock-vault-tab__intersection-hint">
                {ko.stockVault.intersectionHint.replace("{n}", String(filtered.length))}
              </p>
            ) : null}
          </div>

          {showMa120ApproachFilters ? (
              <div
                className="stock-vault-tab__filters stock-vault-tab__filters--ma120-approach"
                role="group"
                aria-label={ko.stockVault.ma120ApproachFilterAria}
              >
                <div className="market-tabs market-tabs--vault-scan">
                  {(
                    [
                      ["from_below", ko.stockVault.ma120ApproachFromBelow],
                      ["from_above", ko.stockVault.ma120ApproachFromAbove],
                    ] as const
                  ).map(([approach, label]) => {
                    const active = ma120ApproachFilter === approach;
                    return (
                      <button
                        key={approach}
                        type="button"
                        className={
                          active
                            ? "market-tab market-tab--toggle active stock-vault-tab__ma120-approach-btn"
                            : "market-tab market-tab--toggle stock-vault-tab__ma120-approach-btn"
                        }
                        aria-pressed={active}
                        onClick={() => selectMa120ApproachFilter(approach)}
                      >
                        {label}
                        <span className="market-tab__count">
                          {ma120ApproachCounts[approach]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

          <div
            className="stock-vault-tab__filters panel-head__filters"
            role="tablist"
            aria-label={ko.stockVault.filterMarketAria}
          >
            <div className="market-tabs">
              {(
                [
                  ["all", ko.stockVault.filterAll, marketCounts.all],
                  ["kr", ko.app.marketKr, marketCounts.kr],
                  ["us", ko.app.marketUs, marketCounts.us],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={marketFilter === id}
                  className={marketFilter === id ? "market-tab active" : "market-tab"}
                  onClick={() => setMarketFilter(id)}
                >
                  {label}
                  <span className="market-tab__count">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div
            className="stock-vault-tab__filters panel-head__filters"
            role="tablist"
            aria-label={ko.stockVault.filterAria}
          >
            <div className="market-tabs">
              {(
                [
                  ["all", ko.stockVault.filterAll],
                  ["favorite", ko.stockVault.filterFavorite, favoriteCount],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  className={filter === id ? "market-tab active" : "market-tab"}
                  onClick={() => setFilter(id)}
                >
                  {label}
                  {typeof count === "number" ? (
                    <span className="market-tab__count">{count}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {industryTabs.length > 0 ? (
            <IndustryFilterPanel
              ariaLabel={ko.stockVault.filterIndustryAria}
              totalCount={baseFiltered.length}
              industryFilter={industryFilter}
              onSelectAll={() => setIndustryFilter("all")}
              industryOptions={industryOptions}
              industryGrid={industryGrid}
              onToggleIndustry={(name) =>
                setIndustryFilter((cur) => (cur === name ? "all" : name))
              }
            />
          ) : null}
        </div>

        {(loading && displayItems.length === 0 && !isHistoricalView) ||
        (isHistoricalView && snapshotLoading) ? (
          <p className="stock-vault-tab__muted">{ko.stockVault.loading}</p>
        ) : error ? (
          <p className="stock-vault-tab__error" role="alert">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="stock-vault-tab__muted">
            {isHistoricalView
              ? ko.stockVault.historyEmpty
              : showSelectScanCondition
                ? ko.stockVault.selectScanCondition
                : showEmptyIntersection
                  ? ko.stockVault.emptyIntersection
                  : ko.stockVault.empty}
          </p>
        ) : (
          <>
          <StockVaultRowBubblePortal actionsRef={rowBubbleActionsRef} tipId={rowBubbleTipId} />
          <ul className="stock-vault-tab__list">
            {visibleRows.map((row) => {
              const symKey = row.symbol.trim().toUpperCase();
              const quote = quotes[symKey];
              const metaRow = meta[symKey];
              const display = resolveSymbolDisplayName(
                row.symbol,
                metaRow?.nameKo ?? row.name,
                row.market,
              );
              const industry = getRowIndustry(row);
              const tvSymbol = yahooStockSymbolToTradingView(
                row.symbol,
                row.market,
                metaRow?.exchange,
              );
              const cur =
                quote?.currency ?? (row.market === "kr" ? "KRW" : "USD");
              const chg = quote?.changePercent;
              const chgUp = chg != null && chg >= 0;
              const gcItem = row.goldenCross;
              const bottomItem = row.bottomCandle;
              const gcRecencyClass = gcItem ? goldenCrossRecencyClass(gcItem) : null;
              const rowClassName = [
                "stock-vault-tab__row",
                stockVaultTimeframeRowClass(row.timeframe),
                gcRecencyClass,
              ]
                .filter(Boolean)
                .join(" ");
              const scanDate =
                gcItem?.crossDate ??
                gcItem?.scanDate ??
                row.maAlign?.scanDate ??
                bottomItem?.signalDate ??
                bottomItem?.scanDate ??
                null;
              const sourceLabels =
                row.scanSources.length > 0
                  ? row.scanSources.map((s) => SOURCE_BADGE_LABEL[s])
                  : row.favorite
                    ? [ko.stockVault.sourceFavorite]
                    : [];
              const gcChain = formatGoldenCrossChain(gcItem?.crosses);
              const ma120Label = row.ma120Near
                ? formatMa120NearLabel(
                    row.ma120Near.distancePct,
                    resolveMa120Approach(
                      row.ma120Near,
                      chartInsights[symKey],
                      quote?.price,
                    ),
                    {
                      fromBelow: ko.stockVault.maApproachFromBelow,
                      fromAbove: ko.stockVault.maApproachFromAbove,
                    },
                  )
                : null;
              const bottomLabel = bottomItem?.bottomTag
                ? `${bottomItem.bottomTag}${
                    bottomItem.bottomScore != null ? ` ${bottomItem.bottomScore}pt` : ""
                  }`
                : null;
              const hasSignalBadges =
                Boolean(gcChain) ||
                Boolean(row.maAlign) ||
                Boolean(ma120Label) ||
                Boolean(bottomLabel);
              const openRowBubble = (
                el: HTMLElement,
                opts?: { immediate?: boolean },
              ) =>
                rowBubbleActionsRef.current?.showTip(
                  el,
                  {
                    symbol: row.symbol,
                    name: display.label,
                    market: row.market,
                    industry,
                    tvSymbol,
                    price: quote?.price ?? null,
                    currency: cur ?? null,
                  },
                  opts,
                );

              return (
              <li
                key={row.key}
                className={rowClassName}
                aria-describedby={rowBubbleTipId}
                onMouseEnter={(e) => openRowBubble(e.currentTarget)}
                onMouseLeave={() => rowBubbleActionsRef.current?.scheduleHideTip()}
              >
                <div
                  className="stock-vault-tab__row-link"
                  tabIndex={0}
                  aria-label={`${display.label} ${ko.stockVault.rowBubbleAria}`}
                  onFocus={(e) =>
                    openRowBubble(
                      e.currentTarget.closest("li") ?? e.currentTarget,
                      { immediate: true },
                    )
                  }
                  onBlur={(e) => {
                    const rel = e.relatedTarget as Node | null;
                    if (rel && document.getElementById(rowBubbleTipId)?.contains(rel)) return;
                    rowBubbleActionsRef.current?.scheduleHideTip();
                  }}
                >
                  <div className="stock-vault-tab__row-top">
                    <div className="stock-vault-tab__row-main">
                      <div className="stock-vault-tab__row-head">
                        <span
                          className="stock-vault-tab__name"
                          title={display.label}
                        >
                          {display.label}
                        </span>
                        {display.sublabel ? (
                          <span className="stock-vault-tab__sym">{display.sublabel}</span>
                        ) : null}
                        {industry ? (
                          <span className="stock-vault-tab__sector-inline">{industry}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="stock-vault-tab__row-aside">
                      <div className="stock-vault-tab__quote">
                        {quote?.price != null && Number.isFinite(quote.price) ? (
                          <>
                            <span className="stock-vault-tab__price">
                              {formatPrice(quote.price, cur)}
                            </span>
                            {chg != null && Number.isFinite(chg) ? (
                              <span
                                className={
                                  chgUp
                                    ? "stock-vault-tab__chg stock-vault-tab__chg--up"
                                    : "stock-vault-tab__chg stock-vault-tab__chg--down"
                                }
                              >
                                {formatPercent(chg)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="stock-vault-tab__quote-pending">
                            {ko.app.stockLookupQuotePending}
                          </span>
                        )}
                      </div>
                      <div className="stock-vault-tab__row-actions">
                        <button
                          type="button"
                          className={
                            row.favorited
                              ? "stock-vault-tab__favorite stock-vault-tab__favorite--on"
                              : "stock-vault-tab__favorite"
                          }
                          aria-label={
                            row.favorited
                              ? `${display.label} ${ko.stockVault.favoriteRemoveAria}`
                              : `${display.label} ${ko.stockVault.favoriteAddAria}`
                          }
                          title={
                            row.favorited
                              ? ko.stockVault.favoriteRemove
                              : ko.stockVault.favoriteAdd
                          }
                          aria-pressed={Boolean(row.favorited)}
                          disabled={favoriting === row.symbol}
                          onClick={() =>
                            void handleToggleFavorite(
                              row.symbol,
                              Boolean(row.favorited),
                              row.market,
                              display.label,
                            )
                          }
                        >
                          <VaultBookmarkIcon filled={Boolean(row.favorited)} />
                        </button>
                        {!isHistoricalView ? (
                          <button
                            type="button"
                            className="stock-vault-tab__remove"
                            aria-label={`${display.label} ${ko.stockVault.removeAria}`}
                            title={ko.stockVault.remove}
                            disabled={removing === row.symbol || !authenticated}
                            onClick={() => void handleRemove(row.symbol)}
                          >
                            <span className="stock-vault-tab__remove-icon" aria-hidden>
                              ×
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="stock-vault-tab__meta">
                    <span className="stock-vault-tab__market">
                      {row.market === "kr" ? ko.app.marketKr : ko.app.marketUs}
                    </span>
                    {sourceLabels.map((label) => (
                      <span key={label} className="stock-vault-tab__source">
                        {label}
                      </span>
                    ))}
                    <span className={stockVaultTimeframeBadgeClass(row.timeframe)}>
                      {stockVaultTimeframeLabel(row.timeframe)}
                    </span>
                    {scanDate ? (
                      <span className="stock-vault-tab__scan-date">{scanDate}</span>
                    ) : (
                      <span className="stock-vault-tab__added">
                        {fmtDate(row.updatedAtMs)}
                      </span>
                    )}
                  </div>
                  {hasSignalBadges ? (
                    <div className="stock-vault-tab__crosses">
                      {gcChain ? (
                        <span className="stock-vault-tab__cross">{gcChain}</span>
                      ) : null}
                      {row.maAlign ? (
                        <span
                          className="stock-vault-tab__cross stock-vault-tab__cross--align"
                          title={ko.stockVault.maAlignBadgeHint}
                        >
                          {formatMaAlignChain()}
                        </span>
                      ) : null}
                      {ma120Label ? (
                        <span
                          className="stock-vault-tab__cross stock-vault-tab__cross--ma120"
                          title={ko.stockVault.ma120NearBadgeHint}
                        >
                          {ma120Label}
                        </span>
                      ) : null}
                      {bottomLabel ? (
                        <span
                          className="stock-vault-tab__cross stock-vault-tab__cross--bottom"
                          title={ko.stockVault.bottomCandleBadgeHint}
                        >
                          {bottomLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {row.favorited ? (() => {
                    const track = rowFavoriteTrack(row);
                    const metaRow = favoriteMeta[symKey];
                    return (
                      <FavoriteTrackPanel
                        symbol={row.symbol}
                        market={row.market}
                        addedAtMs={track.addedAtMs ?? metaRow?.addedAtMs}
                        basePrice={track.favoritePrice ?? metaRow?.favoritePrice}
                        currentPrice={quote?.price}
                        currency={cur}
                        editable={authenticated}
                        onBasePriceSaved={(price) =>
                          handleFavoritePriceSaved(row.symbol, price)
                        }
                      />
                    );
                  })() : null}
                </div>
              </li>
              );
            })}
          </ul>
          {hasMoreRows ? (
            <div className="stock-vault-tab__list-more-wrap">
              <button
                type="button"
                className="stock-vault-tab__list-more"
                onClick={() =>
                  setListVisibleCount((n) =>
                    Math.min(n + VAULT_LIST_ROW_STEP, deferredFiltered.length),
                  )
                }
              >
                {ko.stockVault.loadMoreRows(visibleRows.length, deferredFiltered.length)}
              </button>
            </div>
          ) : null}
          </>
        )}
      </section>
    </div>
  );
}
