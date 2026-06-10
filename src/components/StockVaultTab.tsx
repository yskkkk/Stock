import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FavoriteTrackPanel from "./FavoriteTrackPanel";
import {
  fetchGoldenCrossHistory,
  fetchGoldenCrossStatus,
  fetchMaAlignHistory,
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
  type VaultDisplayRow,
} from "../lib/stockVaultFilter";
import {
  buildVaultItemsFromScanHistory,
  mergeScanHistoryDates,
} from "../lib/stockVaultHistory";
import {
  STOCK_VAULT_TIMEFRAMES,
  stockVaultTimeframeBadgeClass,
  stockVaultTimeframeLabel,
  stockVaultTimeframeRowClass,
} from "../lib/stockVaultTimeframe";
import {
  loadStockVault,
  peekStockVaultPrefetch,
  refreshStockVaultTab,
  subscribeStockVaultPrefetch,
  updateStockVaultPrefetchVault,
} from "../lib/tabPrefetch";
import { yahooStockSymbolToTradingView } from "../lib/tradingviewSymbols";
import {
  formatGoldenCrossChain,
  formatMaAlignChain,
} from "../lib/stockVaultMaDisplay";
import type {
  StockVaultFavoriteMeta,
  StockVaultIndustryFinancials,
  StockVaultItem,
  StockVaultResponse,
  StockVaultScanSource,
  StockVaultScanStatus,
  StockVaultTimeframe,
} from "../types";
import { VaultBookmarkIcon, VaultSectorLeaderIcon } from "./StockVaultMarkButton";
import { useStockVaultRowBubble } from "./StockVaultRowBubble";

const SCAN_SOURCE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.tabGolden,
  ma_align: ko.stockVault.tabMaAlign,
};

const SOURCE_BADGE_LABEL: Record<StockVaultScanSource, string> = {
  golden_cross: ko.stockVault.sourceGolden,
  ma_align: ko.stockVault.sourceMaAlign,
};

const SCAN_POLL_MS = 2500;
const QUOTE_POLL_MS = 60_000;

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
  if (!gcState || !maState) return null;
  const parts = [
    scanHintFromState(ko.stockVault.lastScanGolden, gcState),
    scanHintFromState(ko.stockVault.lastScanMaAlign, maState),
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
  const src = row.favorite ?? row.goldenCross ?? row.maAlign;
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
    authenticated: Boolean(vault.authenticated),
    favoriteMeta: vault.favoriteMeta ?? {},
    industryTabs: vault.industryTabs?.length ? vault.industryTabs : [],
    industryGridRows:
      typeof vault.industryGridRows === "number" && vault.industryGridRows > 0
        ? vault.industryGridRows
        : vault.industryTabs?.length
          ? Math.max(16, Math.ceil(vault.industryTabs.length / 8))
          : 20,
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
  const [industryTabs, setIndustryTabs] = useState<string[]>(
    () => cachedVault?.industryTabs ?? [],
  );
  const [industryGridRows, setIndustryGridRows] = useState(
    () => cachedVault?.industryGridRows ?? 20,
  );
  const [loading, setLoading] = useState(!cachedInit);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [selectedScanSources, setSelectedScanSources] = useState<
    StockVaultScanSource[]
  >(["golden_cross"]);
  const [timeframeFilter, setTimeframeFilter] =
    useState<StockVaultTimeframe>("1d");
  const [marketFilter, setMarketFilter] = useState<"all" | "kr" | "us">("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
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
  const [selectedScanDate, setSelectedScanDate] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<StockVaultItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
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
      setAuthenticated(Boolean(vault.authenticated));
      setFavoriteMeta(vault.favoriteMeta ?? {});
      setIndustryTabs((prev) =>
        vault.industryTabs?.length ? vault.industryTabs : prev,
      );
      setIndustryGridRows((prev) =>
        typeof vault.industryGridRows === "number" && vault.industryGridRows > 0
          ? vault.industryGridRows
          : vault.industryTabs?.length
            ? Math.max(16, Math.ceil(vault.industryTabs.length / 8))
            : prev,
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

  const reloadVault = useCallback(async () => {
    const bundle = await loadStockVault();
    applyVaultResponse(bundle.vault);
  }, [applyVaultResponse]);

  const reload = useCallback(async (force = false) => {
    const hadCache = !force && Boolean(peekStockVaultPrefetch());
    if (!hadCache) {
      setLoading(true);
    }
    setError(null);
    try {
      const bundle = force ? await refreshStockVaultTab() : await loadStockVault();
      applyVaultResponse(bundle.vault);
      applyScanStatus(bundle.scanStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyVaultResponse, applyScanStatus]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshHistoryDates = useCallback(async () => {
    try {
      const [gc, ma] = await Promise.all([
        fetchGoldenCrossHistory(),
        fetchMaAlignHistory(),
      ]);
      setHistoryDates(mergeScanHistoryDates(gc.dates, ma.dates));
    } catch {
      /* ignore */
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
    if (!selectedScanDate) {
      setHistoryItems(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void (async () => {
      try {
        const [gc, ma] = await Promise.all([
          fetchGoldenCrossHistory({
            scanDate: selectedScanDate,
            detail: true,
          }),
          fetchMaAlignHistory({
            scanDate: selectedScanDate,
            detail: true,
          }),
        ]);
        if (cancelled) return;
        setHistoryItems(
          buildVaultItemsFromScanHistory(
            selectedScanDate,
            gc.entries ?? [],
            ma.entries ?? [],
            {
              favoriteSymbols: favoriteSymbolSet,
              favoriteMeta,
              timeframe: timeframeFilter,
            },
          ),
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedScanDate, favoriteSymbolSet, favoriteMeta, timeframeFilter]);

  const displayItems = useMemo(
    () =>
      isHistoricalView && historyItems != null ? historyItems : items,
    [isHistoricalView, historyItems, items],
  );

  useEffect(() => {
    return subscribeStockVaultPrefetch((bundle) => {
      applyVaultResponse(bundle.vault);
      applyScanStatus(bundle.scanStatus);
      setLoading(false);
      setError(null);
    });
  }, [applyVaultResponse, applyScanStatus]);

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
  }, [scanRunning, applyScanStatus, applyVaultResponse, refreshHistoryDates]);

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

  const toggleScanSource = useCallback((source: StockVaultScanSource) => {
    setIndustryFilter("all");
    setSelectedScanSources((prev) => {
      const set = new Set(prev);
      if (set.has(source)) {
        set.delete(source);
      } else {
        set.add(source);
      }
      return STOCK_VAULT_SCAN_SOURCES.filter((s) => set.has(s));
    });
  }, []);

  const scanSourceCounts = useMemo(
    () =>
      Object.fromEntries(
        STOCK_VAULT_SCAN_SOURCES.map((source) => [
          source,
          countItemsByScanSource(displayItems, source, timeframeFilter),
        ]),
      ) as Record<StockVaultScanSource, number>,
    [displayItems, timeframeFilter],
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
    if (industryFilter === "all") return baseFiltered;
    return baseFiltered.filter((row) => getRowIndustry(row) === industryFilter);
  }, [baseFiltered, industryFilter, getRowIndustry]);

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

  const industryGridCols = useMemo(
    () =>
      Math.max(1, Math.ceil(industryTabs.length / Math.max(1, industryGridRows))),
    [industryTabs.length, industryGridRows],
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
              <select
                className="input stock-vault-tab__history-select"
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
          {!authenticated ? (
            <p className="stock-vault-tab__desc">{ko.stockVault.loginHint}</p>
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
              {STOCK_VAULT_SCAN_SOURCES.map((source) => {
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
            <div
              className="stock-vault-tab__filters stock-vault-tab__filters--industry"
              role="tablist"
              aria-label={ko.stockVault.filterIndustryAria}
            >
              <button
                type="button"
                role="tab"
                aria-selected={industryFilter === "all"}
                className={
                  industryFilter === "all"
                    ? "market-tab market-tab--industry-all active"
                    : "market-tab market-tab--industry-all"
                }
                onClick={() => setIndustryFilter("all")}
              >
                <span className="market-tab__label">{ko.stockVault.filterAll}</span>
                <span className="market-tab__count">{baseFiltered.length}</span>
              </button>
              <div className="stock-vault-tab__industry-grid-scroll">
                <div
                  className="stock-vault-tab__industry-grid"
                  style={
                    {
                      "--stock-vault-industry-rows": String(industryGridRows),
                      "--stock-vault-industry-cols": String(industryGridCols),
                    } as React.CSSProperties
                  }
                >
                  {industryOptions.map(({ name, count }) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={industryFilter === name}
                    className={
                      industryFilter === name
                        ? "market-tab active"
                        : count > 0
                          ? "market-tab"
                          : "market-tab market-tab--empty"
                    }
                    onClick={() => setIndustryFilter(name)}
                  >
                    <span className="market-tab__label">{name}</span>
                    <span className="market-tab__count">{count}</span>
                  </button>
                ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {loading || (isHistoricalView && historyLoading) ? (
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
              const tvSymbol =
                metaRow?.tvSymbol ??
                yahooStockSymbolToTradingView(
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
              return (
              <li key={row.key} className={rowClassName}>
                <div
                  className="stock-vault-tab__row-link"
                  role="button"
                  tabIndex={0}
                  aria-describedby={tipId}
                  aria-label={`${display.label} ${ko.stockVault.rowBubbleAria}`}
                  onMouseEnter={(e) =>
                    showTip(e.currentTarget, {
                      symbol: row.symbol,
                      name: display.label,
                      market: row.market,
                      industry,
                      tvSymbol,
                      fin: finRow,
                      sectorLeader,
                    })
                  }
                  onMouseLeave={scheduleHideTip}
                  onFocus={(e) =>
                    showTip(e.currentTarget, {
                      symbol: row.symbol,
                      name: display.label,
                      market: row.market,
                      industry,
                      tvSymbol,
                      fin: finRow,
                      sectorLeader,
                    })
                  }
                  onBlur={scheduleHideTip}
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
                          title={ko.stockVault.sectorLeader}
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
