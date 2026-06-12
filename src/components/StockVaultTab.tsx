import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FavoriteTrackPanel from "./FavoriteTrackPanel";
import IndustryFilterPanel from "./IndustryFilterPanel";
import {
  fetchGoldenCrossHistory,
  fetchGoldenCrossStatus,
  fetchMa120NearHistory,
  fetchMaAlignHistory,
  fetchStockVaultChartInsights,
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
  defaultStockVaultTabUi,
  peekStockVaultTabUi,
  saveStockVaultTabUi,
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
  formatGoldenCrossChain,
  formatMa120NearLabel,
  formatMaAlignChain,
  resolveMa120Approach,
} from "../lib/stockVaultMaDisplay";
import {
  formatMaApproachLabel,
  formatMaNearLabel,
  formatTrendLabel,
  maProximityBadgeClass,
  maProximityPriceClass,
  pickChartInsight,
  trendBadgeClass,
} from "../lib/stockVaultChartInsights";
import type {
  StockVaultFavoriteMeta,
  StockVaultIndustryFinancials,
  StockVaultItem,
  StockVaultResponse,
  StockVaultChartInsightSnapshot,
  StockVaultScanSource,
  StockVaultScanStatus,
  StockVaultTimeframe,
} from "../types";
import { VaultBookmarkIcon, VaultSectorLeaderIcon } from "./StockVaultMarkButton";
import { useStockVaultRowBubble } from "./StockVaultRowBubble";

const SCAN_SOURCE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.tabGolden,
  ma_align: ko.stockVault.tabMaAlign,
  ma120_near: ko.stockVault.tabMa120Near,
};

const SOURCE_BADGE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.sourceGolden,
  ma_align: ko.stockVault.sourceMaAlign,
  ma120_near: ko.stockVault.sourceMa120Near,
};

const SCAN_POLL_MS = 2500;
const QUOTE_POLL_MS = 60_000;
const CHART_INSIGHTS_POLL_MS = 90_000;

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
  const src = row.favorite ?? row.goldenCross ?? row.maAlign ?? row.ma120Near;
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
    industryFinancials: vault.industryFinancials ?? {},
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
  const [industryFinancials, setIndustryFinancials] = useState<
    Record<string, StockVaultIndustryFinancials>
  >(() => cachedVault?.industryFinancials ?? {});
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
  const { tipId, showTip, scheduleHideTip, bubble: rowBubble } =
    useStockVaultRowBubble();

  const applyVaultResponse = useCallback(
    (vault: StockVaultResponse) => {
      setItems(vault.items ?? []);
      setQuotes(vault.quotes ?? {});
      setMeta(vault.meta ?? {});
      setIndustryFinancials(vault.industryFinancials ?? {});
      setChartInsights(
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
      );
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

  const seedTodaySnapshotFromVault = useCallback(
    (vault: StockVaultResponse) => {
      const today = kstTodayYmd();
      const cached = peekLocalScanSnapshot(today);
      if (cached?.length) {
        if (selectedScanDate == null) setSnapshotItems(cached);
        return;
      }
      const incoming = extractScanItemsFromVault(vault.items);
      if (!incoming.length) return;
      const saved = saveLocalScanSnapshot(today, incoming);
      if (selectedScanDate == null) setSnapshotItems(saved);
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

  const reloadVault = useCallback(async () => {
    const bundle = await loadStockVault({ refresh: true });
    applyVaultResponse(bundle.vault);
  }, [applyVaultResponse]);

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

  useEffect(() => {
    const insightCount = (snapshotItems?.length ?? 0) + items.filter((it) => it.source === "favorite").length;
    if (insightCount === 0) return;
    let cancelled = false;
    const loadInsights = async () => {
      try {
        const res = await fetchStockVaultChartInsights();
        if (!cancelled && res.chartInsights) {
          setChartInsights(res.chartInsights);
        }
      } catch {
        /* ignore */
      }
    };
    void loadInsights();
    const id = window.setInterval(() => {
      void loadInsights();
    }, CHART_INSIGHTS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [snapshotItems?.length, items.length]);

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
    const snap = snapshotItems ?? [];
    if (isHistoricalView) return snap;
    const extras = items.filter((it) => it.source === "favorite");
    return [...snap, ...extras];
  }, [snapshotItems, items, isHistoricalView]);

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
    if (loading || scanRunning || displayItems.length === 0) return;
    const id = window.setInterval(() => {
      void reloadVault();
    }, QUOTE_POLL_MS);
    return () => window.clearInterval(id);
  }, [loading, scanRunning, displayItems.length, reloadVault]);

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

  const getRowIndustry = useCallback(
    (row: VaultDisplayRow) => rowIndustry(meta, row),
    [meta],
  );

  const toggleScanSource = useCallback(
    (source: StockVaultScanSource) => {
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
      if (
        source === "ma120_near" &&
        countItemsByScanSource(snapshotItems ?? [], "ma120_near", timeframeFilter) === 0 &&
        countItemsByScanSource(items, "ma120_near", timeframeFilter) === 0
      ) {
        void reload(true);
      }
    },
    [items, snapshotItems, timeframeFilter, reload],
  );

  const selectMa120ApproachFilter = useCallback((approach: Ma120ApproachFilter) => {
    setIndustryFilter("all");
    setMa120ApproachFilter((prev) => (prev === approach ? null : approach));
  }, []);

  useEffect(() => {
    if (timeframeFilter !== "1wk") return;
    setSelectedScanSources((prev) => {
      const next = prev.filter((s) => s !== "ma120_near");
      return next.length ? next : ["golden_cross"];
    });
    setMa120ApproachFilter(null);
  }, [timeframeFilter]);

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

  const preMarketRows = useMemo(
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
      buildVaultDisplayRows(displayItems, {
        selectedScanSources,
        marketFilter,
        favoriteOnly: filter === "favorite",
        timeframeFilter,
      }),
    [displayItems, selectedScanSources, marketFilter, filter, timeframeFilter],
  );

  const favoriteCount = useMemo(
    () => preMarketRows.filter((r) => r.favorited).length,
    [preMarketRows],
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
      all: preMarketRows.length,
      kr: preMarketRows.filter((r) => r.market === "kr").length,
      us: preMarketRows.filter((r) => r.market === "us").length,
    }),
    [preMarketRows],
  );

  const handleRemove = useCallback(
    async (symbol: string) => {
      if (!authenticated) {
        setError(ko.stockVault.loginRequired);
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRemoving(null);
      }
    },
    [authenticated, onVaultChange],
  );

  const handleToggleFavorite = useCallback(
    async (symbol: string, favorited: boolean, market: "kr" | "us", name: string) => {
      if (!authenticated) {
        setError(ko.stockVault.loginRequired);
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
    [authenticated, quotes, onVaultChange],
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
          </div>

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
          <ul className="stock-vault-tab__list">
            {filtered.map((row) => {
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
                null;
              const sourceLabels =
                row.scanSources.length > 0
                  ? row.scanSources.map((s) => SOURCE_BADGE_LABEL[s])
                  : row.favorite
                    ? [ko.stockVault.sourceFavorite]
                    : [];
              const finRow = industryFinancials[symKey];
              const sectorLeader = Boolean(finRow?.sectorLeader);
              const chartInsight = pickChartInsight(chartInsights, symKey);
              const dailyTrend = chartInsight?.daily?.trend ?? "neutral";
              const weeklyTrend = chartInsight?.weekly?.trend ?? "neutral";
              const maNearHits = [
                ...(chartInsight?.daily?.near ?? []).map((hit) => ({
                  ...hit,
                  timeframe: "daily" as const,
                })),
                ...(chartInsight?.weekly?.near ?? []).map((hit) => ({
                  ...hit,
                  timeframe: "weekly" as const,
                })),
              ];
              const maPriceClass = maProximityPriceClass(chartInsight?.weekly?.near);
              const openRowBubble = (el: HTMLElement) =>
                showTip(el, {
                  symbol: row.symbol,
                  name: display.label,
                  market: row.market,
                  industry,
                  tvSymbol,
                  price: quote?.price ?? null,
                  currency: cur ?? null,
                });

              return (
              <li
                key={row.key}
                className={rowClassName}
                aria-describedby={tipId}
                onMouseEnter={(e) => openRowBubble(e.currentTarget)}
                onMouseLeave={scheduleHideTip}
              >
                <div
                  className="stock-vault-tab__row-link"
                  tabIndex={0}
                  aria-label={`${display.label} ${ko.stockVault.rowBubbleAria}`}
                  onFocus={(e) => openRowBubble(e.currentTarget.closest("li") ?? e.currentTarget)}
                  onBlur={(e) => {
                    const rel = e.relatedTarget as Node | null;
                    if (rel && document.getElementById(tipId)?.contains(rel)) return;
                    scheduleHideTip();
                  }}
                >
                  <div className="stock-vault-tab__row-main">
                    <div className="stock-vault-tab__row-head">
                      <span
                        className="stock-vault-tab__name"
                        title={display.label}
                      >
                        {display.label}
                      </span>
                      {sectorLeader ? (
                        <span
                          className="stock-vault-tab__leader"
                          title={
                            finRow?.sectorLeaderDetail
                              ? `${ko.stockVault.sectorLeader} · ${finRow.sectorLeaderDetail}${
                                  finRow.industryUniversePeerCount
                                    ? ` · ${ko.stockVault.sectorLeaderUniversePeers(finRow.industryUniversePeerCount)}`
                                    : ""
                                }`
                              : ko.stockVault.sectorLeaderAria
                          }
                          aria-label={ko.stockVault.sectorLeaderAria}
                        >
                          <VaultSectorLeaderIcon />
                        </span>
                      ) : null}
                      {display.sublabel ? (
                        <span className="stock-vault-tab__sym">{display.sublabel}</span>
                      ) : null}
                    </div>
                    <p className="stock-vault-tab__sector">{industry}</p>
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
                      <span
                        className={`stock-vault-tab__trend ${trendBadgeClass(dailyTrend)}`}
                        title={formatTrendLabel("daily", dailyTrend, {
                          dailyUp: ko.stockVault.trendDailyUp,
                          dailyDown: ko.stockVault.trendDailyDown,
                          dailyNeutral: ko.stockVault.trendDailyNeutral,
                          weeklyUp: ko.stockVault.trendWeeklyUp,
                          weeklyDown: ko.stockVault.trendWeeklyDown,
                          weeklyNeutral: ko.stockVault.trendWeeklyNeutral,
                        })}
                      >
                        {formatTrendLabel("daily", dailyTrend, {
                          dailyUp: ko.stockVault.trendDailyUp,
                          dailyDown: ko.stockVault.trendDailyDown,
                          dailyNeutral: ko.stockVault.trendDailyNeutral,
                          weeklyUp: ko.stockVault.trendWeeklyUp,
                          weeklyDown: ko.stockVault.trendWeeklyDown,
                          weeklyNeutral: ko.stockVault.trendWeeklyNeutral,
                        })}
                      </span>
                      <span
                        className={`stock-vault-tab__trend ${trendBadgeClass(weeklyTrend)}`}
                        title={formatTrendLabel("weekly", weeklyTrend, {
                          dailyUp: ko.stockVault.trendDailyUp,
                          dailyDown: ko.stockVault.trendDailyDown,
                          dailyNeutral: ko.stockVault.trendDailyNeutral,
                          weeklyUp: ko.stockVault.trendWeeklyUp,
                          weeklyDown: ko.stockVault.trendWeeklyDown,
                          weeklyNeutral: ko.stockVault.trendWeeklyNeutral,
                        })}
                      >
                        {formatTrendLabel("weekly", weeklyTrend, {
                          dailyUp: ko.stockVault.trendDailyUp,
                          dailyDown: ko.stockVault.trendDailyDown,
                          dailyNeutral: ko.stockVault.trendDailyNeutral,
                          weeklyUp: ko.stockVault.trendWeeklyUp,
                          weeklyDown: ko.stockVault.trendWeeklyDown,
                          weeklyNeutral: ko.stockVault.trendWeeklyNeutral,
                        })}
                      </span>
                      {scanDate ? (
                        <span className="stock-vault-tab__scan-date">
                          {scanDate}
                        </span>
                      ) : null}
                      <span className="stock-vault-tab__added">
                        {fmtDate(row.updatedAtMs)}
                      </span>
                    </div>
                    {(() => {
                      const gcChain = formatGoldenCrossChain(gcItem?.crosses);
                      return gcChain ? (
                        <div className="stock-vault-tab__crosses">
                          <span className="stock-vault-tab__cross">
                            {gcChain}
                          </span>
                        </div>
                      ) : null;
                    })()}
                    {row.maAlign ? (
                      <div className="stock-vault-tab__crosses">
                        <span
                          className="stock-vault-tab__cross stock-vault-tab__cross--align"
                          title={ko.stockVault.maAlignBadgeHint}
                        >
                          {formatMaAlignChain()}
                        </span>
                      </div>
                    ) : null}
                    {row.ma120Near ? (
                      <div className="stock-vault-tab__crosses">
                        <span
                          className="stock-vault-tab__cross stock-vault-tab__cross--ma120"
                          title={ko.stockVault.ma120NearBadgeHint}
                        >
                          {formatMa120NearLabel(
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
                          )}
                        </span>
                      </div>
                    ) : null}
                    {maNearHits.length > 0 ? (
                      <div className="stock-vault-tab__ma-near-wrap">
                        {maNearHits.map((hit) => {
                          const approachLabel = formatMaApproachLabel(hit.approach, {
                            fromBelow: ko.stockVault.maApproachFromBelow,
                            fromAbove: ko.stockVault.maApproachFromAbove,
                            flat: ko.stockVault.maApproachFlat,
                          });
                          return (
                            <span
                              key={`${row.key}-${hit.timeframe}-ma-${hit.period}`}
                              className={[
                                "stock-vault-tab__ma-near",
                                maProximityBadgeClass(hit.period),
                                hit.timeframe === "daily"
                                  ? "stock-vault-tab__ma-near--daily"
                                  : "stock-vault-tab__ma-near--weekly",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              title={
                                hit.timeframe === "daily"
                                  ? ko.stockVault.dailyMaNearHint(
                                      hit.period,
                                      hit.diffPct,
                                      hit.side,
                                      hit.approach,
                                    )
                                  : ko.stockVault.weeklyMaNearHint(
                                      hit.period,
                                      hit.diffPct,
                                      hit.side,
                                      hit.approach,
                                    )
                              }
                            >
                              {formatMaNearLabel(hit.timeframe, hit.period, {
                                dailyNear: ko.stockVault.dailyMaNear,
                                weeklyNear: ko.stockVault.weeklyMaNear,
                              })}
                              {approachLabel ? ` · ${approachLabel}` : ""}
                            </span>
                          );
                        })}
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
                  <div className="stock-vault-tab__quote">
                    {quote?.price != null && Number.isFinite(quote.price) ? (
                      <>
                        <span
                          className={[
                            "stock-vault-tab__price",
                            maPriceClass,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
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
                      <span className="stock-vault-tab__remove-label">
                        {ko.stockVault.remove}
                      </span>
                    </button>
                  ) : null}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>
      {rowBubble}
    </div>
  );
}
