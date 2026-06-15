import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import { pickChartInsight } from "../lib/stockVaultChartInsights";
import {
  buildVaultDisplayRows,
  countItemsByScanSource,
  countScanSourceTotals,
  countVaultIntersection,
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
  stockVaultTimeframeLabel,
} from "../lib/stockVaultTimeframe";
import { industryGridDimensions } from "../lib/industryGridLayout";
import {
  VAULT_CHART_INSIGHT_SYMBOL_BATCH,
  VAULT_LIST_INITIAL_ROWS,
  VAULT_LIST_ROW_STEP,
  VAULT_QUOTE_DRAIN_MS,
  mergeVaultQuotePatch,
  overlayVaultFavoriteState,
  patchVaultItemFavorite,
  pickQuoteBatch,
  pruneSymbolRecord,
  symbolsMissingQuotes,
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
  pinStockVaultSessionCache,
  refreshStockVaultTab,
  scheduleIdle,
  subscribeStockVaultPrefetch,
  updateStockVaultPrefetchVault,
} from "../lib/tabPrefetch";
import { yahooStockSymbolToTradingView } from "../lib/tradingviewSymbols";
import {
  enrichMa120ItemSide,
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
import StockVaultRow from "./StockVaultRow";
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

function useAfterPaintReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setReady(true));
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, []);
  return ready;
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
  const localSnapshotAtInit = useMemo(
    () => peekLocalScanSnapshot(uiInit.selectedScanDate ?? kstTodayYmd()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount snapshot only
    [],
  );
  const hasLocalSnapshotAtInit = Boolean(localSnapshotAtInit?.length);
  const { user, authChecked, refreshAuth } = useLiveTradeAuth();
  const vaultAuthSyncedRef = useRef(false);
  const loginHintTimerRef = useRef<number | null>(null);

  const [items, setItems] = useState<StockVaultItem[]>(() =>
    hasLocalSnapshotAtInit ? [] : (cachedVault?.items ?? []),
  );
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
  >({});
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
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [selectedScanDate, setSelectedScanDate] = useState<string | null>(
    () => uiInit.selectedScanDate,
  );
  const [snapshotItems, setSnapshotItems] = useState<StockVaultItem[] | null>(
    () => localSnapshotAtInit,
  );
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const listPaintReady = useAfterPaintReady();
  const [industryPanelReady, setIndustryPanelReady] = useState(false);
  const scanBtnRef = useRef<HTMLButtonElement>(null);
  const scanPopoverRef = useRef<HTMLDivElement>(null);
  const chartInsightBatchRef = useRef(0);
  const [listVisibleCount, setListVisibleCount] = useState(VAULT_LIST_INITIAL_ROWS);
  const rowBubbleTipId = useId();
  const rowBubbleActionsRef = useRef<StockVaultRowBubbleActions | null>(null);

  useEffect(() => {
    pinStockVaultSessionCache();
  }, []);

  useEffect(() => {
    if (industryPanelReady) return;
    scheduleIdle(() => setIndustryPanelReady(true), 1800);
  }, [industryPanelReady]);

  const applyVaultResponse = useCallback(
    (vault: StockVaultResponse, opts?: { skipFavorites?: boolean }) => {
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
      if (!opts?.skipFavorites) {
        setFavoriteMeta(vault.favoriteMeta ?? {});
        onVaultChange?.(favoriteVaultSymbols(vault), vault.favoriteMeta);
      }
      setIndustryTabs((prev) =>
        vault.industryTabs?.length ? vault.industryTabs : prev,
      );
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
    const run = () => {
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
    };
    if (hasLocalSnapshotAtInit) {
      scheduleIdle(() => {
        if (cancelled) return;
        void refreshAuth().then((liveUser) => {
          if (cancelled || !liveUser) return;
          setAuthenticated(true);
          vaultAuthSyncedRef.current = true;
          clearVaultLoginHintFlag();
        });
      }, 12000);
    } else {
      run();
    }
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
    hasLocalSnapshotAtInit,
  ]);

  const ensureVaultAuthenticated = useCallback(async () => {
    if (authenticated) return true;
    const liveUser = await refreshAuth();
    if (!liveUser) return false;
    const bundle = await refreshStockVaultTab();
    applyVaultResponse(bundle.vault);
    return Boolean(bundle.vault.authenticated);
  }, [authenticated, refreshAuth, applyVaultResponse]);

  /** 즐겨찾기 토글 — 전체 vault 로드 없이 로그인만 확인 */
  const ensureVaultFavoriteApi = useCallback(async () => {
    if (authenticated || user) {
      if (user && !authenticated) setAuthenticated(true);
      return true;
    }
    const liveUser = await refreshAuth();
    if (!liveUser) return false;
    setAuthenticated(true);
    return true;
  }, [authenticated, user, refreshAuth]);

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
      if (selectedScanDate != null) return;
      const incoming = extractScanItemsFromVault(vault.items);
      if (!incoming.length) return;
      setSnapshotItems((prev) =>
        mergeScanItemsIntoSnapshot(prev ?? [], incoming),
      );
      scheduleIdle(() => {
        mergeLocalScanSnapshot(kstTodayYmd(), incoming);
      }, 5000);
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
      scheduleIdle(() => seedTodaySnapshotFromVault(cachedInit.vault), 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount seed only
  }, []);

  useEffect(() => {
    const hasLocal = Boolean(snapshotItems?.length);
    if (peekStockVaultPrefetch() || isStockVaultSessionPinned()) {
      setLoading(false);
      if (!hasLocal) {
        scheduleIdle(() => void reload(), 400);
      } else {
        scheduleIdle(() => void reload(), 15000);
      }
      return;
    }
    if (hasLocal) {
      setLoading(false);
      scheduleIdle(() => void reload(), 15000);
      return;
    }
    void reload();
  }, [reload, snapshotItems?.length]);

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
    scheduleIdle(() => {
      const local = listLocalScanSnapshotDates();
      if (local.length) setHistoryDates(local);
    }, 800);
    scheduleIdle(() => {
      void refreshHistoryDates();
    }, 5000);
  }, [refreshHistoryDates]);

  const favoriteSymbolSet = useMemo(() => {
    const fromItems = favoriteVaultSymbols({ items, favoriteSymbols: undefined });
    const fromMeta = Object.keys(favoriteMeta).map((s) => s.trim().toUpperCase());
    return new Set([...fromItems, ...fromMeta]);
  }, [items, favoriteMeta]);

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
  }, [selectedScanDate]);

  const displayItems = useMemo(() => {
    let base: StockVaultItem[];
    if (isHistoricalView) {
      base = snapshotItems ?? [];
    } else {
      const snap = snapshotItems ?? [];
      if (!items.length) {
        const fromCache = extractScanItemsFromVault(
          peekStockVaultPrefetch()?.vault?.items ??
            cachedInit?.vault?.items,
        );
        base = fromCache.length
          ? mergeScanItemsIntoSnapshot(snap, fromCache)
          : snap;
      } else {
        const fromVault = extractScanItemsFromVault(items);
        const merged = mergeScanItemsIntoSnapshot(snap, fromVault);
        const extras = items.filter((it) => it.source === "favorite");
        base = extras.length ? [...merged, ...extras] : merged;
      }
    }
    return overlayVaultFavoriteState(base, favoriteMeta);
  }, [snapshotItems, items, isHistoricalView, favoriteMeta, cachedInit?.vault?.items]);

  const getRowIndustry = useCallback(
    (row: VaultDisplayRow) => rowIndustry(meta, row),
    [meta],
  );

  useEffect(() => {
    return subscribeStockVaultPrefetch((bundle) => {
      scheduleIdle(() => {
        applyVaultResponse(bundle.vault, { skipFavorites: true });
        seedTodaySnapshotFromVault(bundle.vault);
        applyScanStatus(bundle.scanStatus);
        setLoading(false);
        setError(null);
      }, 1200);
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
      setIndustryFilter("all");
      setFilter("all");
      setSelectedScanSources((prev) => {
        const wasSelected = prev.includes(source);
        const set = new Set(prev);
        if (wasSelected) set.delete(source);
        else set.add(source);
        let next = STOCK_VAULT_SCAN_SOURCES.filter((s) => set.has(s));
        if (!next.length) next = [source];
        return next;
      });
      const zero =
        countItemsByScanSource(displayItems, source, timeframeFilter) === 0;
      if ((source === "ma120_near" || source === "bottom_candle") && zero) {
        void reload(true);
      }
    },
    [displayItems, timeframeFilter, reload],
  );

  useEffect(() => {
    if (!selectedScanSources.includes("ma120_near") && ma120ApproachFilter != null) {
      setMa120ApproachFilter(null);
    }
  }, [selectedScanSources, ma120ApproachFilter]);

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
    if (
      timeframeFilter !== "1d" ||
      !selectedScanSources.includes("ma120_near")
    ) {
      return counts;
    }
    for (const it of displayItems) {
      if (it.source !== "ma120_near") continue;
      if (marketFilter !== "all" && it.market !== marketFilter) continue;
      const sym = it.symbol.trim().toUpperCase();
      const approach = resolveMa120Approach(it, chartInsights[sym], quotes[sym]?.price);
      if (approach === "from_below") counts.from_below += 1;
      else if (approach === "from_above") counts.from_above += 1;
    }
    return counts;
  }, [displayItems, marketFilter, timeframeFilter, chartInsights, quotes, selectedScanSources]);

  const showMa120ApproachFilters =
    selectedScanSources.includes("ma120_near") && timeframeFilter === "1d";

  const visibleScanSources = useMemo(
    () => visibleStockVaultScanSources(timeframeFilter),
    [timeframeFilter],
  );

  const scanSourceCounts = useMemo(
    () => countScanSourceTotals(displayItems, timeframeFilter),
    [displayItems, timeframeFilter],
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

  useEffect(() => {
    setListVisibleCount(VAULT_LIST_INITIAL_ROWS);
  }, [
    filtered.length,
    selectedScanSources.join(","),
    marketFilter,
    industryFilter,
    timeframeFilter,
    filter,
    selectedScanDate,
  ]);

  const visibleRows = useMemo(
    () => filtered.slice(0, listVisibleCount),
    [filtered, listVisibleCount],
  );

  const hasMoreRows = visibleRows.length < filtered.length;

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

  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  const applyListQuotePatch = useCallback(
    (
      incoming: Record<
        string,
        { price?: number; changePercent?: number; currency?: string } | undefined
      >,
    ) => {
      setQuotes((prev) => mergeVaultQuotePatch(prev, incoming, listPollSymbols));
    },
    [listPollSymbols],
  );

  useEffect(() => {
    if (!listPaintReady || !pageVisible || loading || scanRunning || !listPollSymbols.length) {
      return;
    }
    let cancelled = false;
    let batchIdx = 0;
    let timer: number | null = null;

    const schedule = (ms: number) => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const missing = symbolsMissingQuotes(listPollSymbols, quotesRef.current);
      const pool = missing.length > 0 ? missing : listPollSymbols;
      const batch = pickQuoteBatch(pool, batchIdx);
      batchIdx += 1;
      if (!batch.length) {
        schedule(QUOTE_POLL_MS);
        return;
      }
      try {
        const res = await fetchStockVaultQuotes(batch);
        if (cancelled) return;
        applyListQuotePatch(res.quotes ?? {});
      } catch {
        /* ignore poll errors */
      }
      schedule(missing.length > batch.length ? VAULT_QUOTE_DRAIN_MS : QUOTE_POLL_MS);
    };

    batchIdx = 0;
    schedule(350);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [
    listPaintReady,
    pageVisible,
    loading,
    scanRunning,
    listPollSymbolsKey,
    listPollSymbols,
    applyListQuotePatch,
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
      const sym = symbol.trim().toUpperCase();
      const nextFav = !favorited;
      const quotePrice = quotes[sym]?.price;
      const optimisticMeta: StockVaultFavoriteMeta | null = nextFav
        ? {
            name,
            market,
            addedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            favoritePrice: quotePrice ?? null,
          }
        : null;

      let metaRollback: Record<string, StockVaultFavoriteMeta> | null = null;
      let snapshotRollback: StockVaultItem[] | null = null;

      setFavoriteMeta((prev) => {
        metaRollback = prev;
        const next = { ...prev };
        if (optimisticMeta) next[sym] = optimisticMeta;
        else delete next[sym];
        onVaultChange?.(Object.keys(next), next);
        return next;
      });

      const applyPatch = (prev: StockVaultItem[]) =>
        patchVaultItemFavorite(prev, sym, nextFav, optimisticMeta);

      setItems(applyPatch);
      setSnapshotItems((prev) => {
        if (!prev?.length) return prev;
        snapshotRollback = prev;
        const next = applyPatch(prev);
        if (selectedScanDate == null) {
          saveLocalScanSnapshot(kstTodayYmd(), next);
        }
        return next;
      });

      setFavoriting(sym);
      setError(null);

      const authed = await ensureVaultFavoriteApi();
      if (!authed) {
        if (metaRollback) {
          setFavoriteMeta(metaRollback);
          onVaultChange?.(Object.keys(metaRollback), metaRollback);
        }
        if (snapshotRollback) {
          setSnapshotItems(snapshotRollback);
          if (selectedScanDate == null) {
            saveLocalScanSnapshot(kstTodayYmd(), snapshotRollback);
          }
        }
        showLoginHintOnce();
        setFavoriting(null);
        return;
      }

      try {
        const res = await setStockVaultFavorite(symbol, nextFav, {
          favoritePrice: nextFav ? quotePrice : undefined,
          market,
          name,
        });
        if (res.meta) {
          setFavoriteMeta((prev) => {
            const next = { ...prev, [sym]: res.meta! };
            onVaultChange?.(Object.keys(next), next);
            return next;
          });
        } else if (!nextFav) {
          setFavoriteMeta((prev) => {
            const next = { ...prev };
            delete next[sym];
            onVaultChange?.(Object.keys(next), next);
            return next;
          });
        }
        const patchList = (prev: StockVaultItem[]) =>
          patchVaultItemFavorite(prev, sym, nextFav, res.meta);
        setItems(patchList);
        setSnapshotItems((prev) => {
          if (!prev?.length) return prev;
          const next = patchList(prev);
          if (selectedScanDate == null) {
            saveLocalScanSnapshot(kstTodayYmd(), next);
          }
          return next;
        });
      } catch (e) {
        if (metaRollback) {
          setFavoriteMeta(metaRollback);
          onVaultChange?.(Object.keys(metaRollback), metaRollback);
        }
        if (snapshotRollback) {
          setSnapshotItems(snapshotRollback);
          if (selectedScanDate == null) {
            saveLocalScanSnapshot(kstTodayYmd(), snapshotRollback);
          }
        }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setFavoriting(null);
      }
    },
    [
      ensureVaultFavoriteApi,
      showLoginHintOnce,
      quotes,
      onVaultChange,
      selectedScanDate,
    ],
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

          {industryPanelReady && industryTabs.length > 0 ? (
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

        <StockVaultRowBubblePortal actionsRef={rowBubbleActionsRef} tipId={rowBubbleTipId} />

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
        ) : !listPaintReady ? (
          <p className="stock-vault-tab__muted">{ko.stockVault.loading}</p>
        ) : (
          <>
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
              const favMeta = favoriteMeta[symKey];
              const track = rowFavoriteTrack(row);
              return (
                <StockVaultRow
                  key={row.key}
                  row={row}
                  quote={quote}
                  displayLabel={display.label}
                  displaySublabel={display.sublabel}
                  industry={getRowIndustry(row)}
                  tvSymbol={yahooStockSymbolToTradingView(
                    row.symbol,
                    row.market,
                    metaRow?.exchange,
                  )}
                  chartInsight={
                    row.ma120Near ? pickChartInsight(chartInsights, symKey) : undefined
                  }
                  favoriteAddedAtMs={track.addedAtMs ?? favMeta?.addedAtMs}
                  favoritePrice={track.favoritePrice ?? favMeta?.favoritePrice}
                  isHistoricalView={isHistoricalView}
                  authenticated={authenticated}
                  favoriting={favoriting}
                  removing={removing}
                  rowBubbleTipId={rowBubbleTipId}
                  bubbleActionsRef={rowBubbleActionsRef}
                  onToggleFavorite={handleToggleFavorite}
                  onRemove={handleRemove}
                  onFavoritePriceSaved={handleFavoritePriceSaved}
                />
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
                    Math.min(n + VAULT_LIST_ROW_STEP, filtered.length),
                  )
                }
              >
                {ko.stockVault.loadMoreRows(visibleRows.length, filtered.length)}
              </button>
            </div>
          ) : null}
          </>
        )}
      </section>
    </div>
  );
}
