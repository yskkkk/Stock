import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGoldenCrossStatus,
  fetchStockVault,
  removeStockVaultItem,
  setStockVaultFavorite,
  triggerGoldenCrossScan,
} from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import {
  goldenCrossRecencyClass,
  sortGoldenCrossItems,
} from "../lib/goldenCrossRecency";
import {
  tradingViewChartUrl,
  yahooStockSymbolToTradingView,
} from "../lib/tradingviewSymbols";
import type { GoldenCrossKind, StockVaultItem, StockVaultKindTab } from "../types";
import { VaultBookmarkIcon } from "./StockVaultMarkButton";

const CROSS_LABEL: Record<GoldenCrossKind, string> = {
  "5>20": "5→20",
  "5>60": "5→60",
  "5>120": "5→120",
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
  goldenCross: { krLastScanDate: string | null; usLastScanDate: string | null },
  maAlign: { krLastScanDate: string | null; usLastScanDate: string | null },
) {
  const fmt = (
    label: string,
    state: { krLastScanDate: string | null; usLastScanDate: string | null },
  ) => {
    const kr = state.krLastScanDate;
    const us = state.usLastScanDate;
    if (!kr && !us) return null;
    const dates = [kr ? `국내 ${kr}` : null, us ? `미국 ${us}` : null]
      .filter(Boolean)
      .join(" · ");
    return `${label} ${dates}`;
  };
  const parts = [
    fmt(ko.stockVault.lastScanGolden, goldenCross),
    fmt(ko.stockVault.lastScanMaAlign, maAlign),
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : null;
}

type VaultFilter = "all" | "favorite";

function manualVaultSymbols(items: StockVaultItem[]) {
  return items
    .filter((it) => it.source === "manual")
    .map((it) => it.symbol.trim().toUpperCase());
}

export default function StockVaultTab({
  onVaultChange,
}: {
  onVaultChange?: (symbols: string[]) => void;
}) {
  const [items, setItems] = useState<StockVaultItem[]>([]);
  const [quotes, setQuotes] = useState<
    Record<string, { price: number; changePercent?: number; currency?: string }>
  >({});
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
  >({});
  const [industryTabs, setIndustryTabs] = useState<string[]>([]);
  const [industryGridRows, setIndustryGridRows] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [kindTab, setKindTab] = useState<StockVaultKindTab>("golden_cross");
  const [marketFilter, setMarketFilter] = useState<"all" | "kr" | "us">("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [authenticated, setAuthenticated] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [favoriting, setFavoriting] = useState<string | null>(null);
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const scanBtnRef = useRef<HTMLButtonElement>(null);
  const scanPopoverRef = useRef<HTMLDivElement>(null);

  const applyVaultResponse = useCallback(
    (vault: Awaited<ReturnType<typeof fetchStockVault>>) => {
      setItems(vault.items ?? []);
      setQuotes(vault.quotes ?? {});
      setMeta(vault.meta ?? {});
      setAuthenticated(Boolean(vault.authenticated));
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
      onVaultChange?.(manualVaultSymbols(vault.items ?? []));
    },
    [onVaultChange],
  );

  const reloadVault = useCallback(async () => {
    const vault = await fetchStockVault();
    applyVaultResponse(vault);
  }, [applyVaultResponse]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vault, status] = await Promise.all([
        fetchStockVault(),
        fetchGoldenCrossStatus().catch(() => null),
      ]);
      applyVaultResponse(vault);
      if (status) {
        setScanEnabled(status.enabled);
        setScanRunning(Boolean(status.running));
        const gcState = status.goldenCross?.state ?? status.state;
        const maState = status.maAlign?.state ?? status.state;
        if (gcState && maState) {
          setScanHint(scanHintFromState(gcState, maState));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyVaultResponse]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (loading || scanRunning || items.length === 0) return;
    const id = window.setInterval(() => {
      void reloadVault();
    }, QUOTE_POLL_MS);
    return () => window.clearInterval(id);
  }, [loading, scanRunning, items.length, reloadVault]);

  useEffect(() => {
    if (!scanRunning) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchGoldenCrossStatus();
          setScanEnabled(status.enabled);
          setScanRunning(Boolean(status.running));
          const gcState = status.goldenCross?.state ?? status.state;
          const maState = status.maAlign?.state ?? status.state;
          if (gcState && maState) {
            setScanHint(scanHintFromState(gcState, maState));
          }
          if (!status.running) {
            await reloadVault();
            setScanNotice(ko.stockVault.scanDone);
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, SCAN_POLL_MS);
    return () => window.clearInterval(id);
  }, [scanRunning, reloadVault]);

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

  const getItemIndustry = useCallback(
    (item: StockVaultItem) => {
      const symKey = item.symbol.trim().toUpperCase();
      return meta[symKey]?.industry?.trim() || null;
    },
    [meta],
  );

  const baseFiltered = useMemo(() => {
    return items.filter((it) => {
      if (it.source !== kindTab) return false;
      if (marketFilter !== "all" && it.market !== marketFilter) return false;
      if (filter === "favorite" && !it.favorited) return false;
      return true;
    });
  }, [items, filter, marketFilter, kindTab]);

  const kindCounts = useMemo(
    () => ({
      golden_cross: items.filter((it) => it.source === "golden_cross").length,
      ma_align: items.filter((it) => it.source === "ma_align").length,
      manual: items.filter((it) => it.source === "manual").length,
    }),
    [items],
  );

  const favoriteCount = useMemo(
    () => items.filter((it) => it.favorited && it.source === kindTab).length,
    [items, kindTab],
  );

  const industryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of baseFiltered) {
      const industry = getItemIndustry(it);
      if (!industry) continue;
      counts.set(industry, (counts.get(industry) ?? 0) + 1);
    }
    return industryTabs.map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    }));
  }, [baseFiltered, getItemIndustry, industryTabs]);

  const filtered = useMemo(() => {
    let list =
      industryFilter === "all"
        ? baseFiltered
        : baseFiltered.filter((it) => getItemIndustry(it) === industryFilter);
    if (kindTab === "golden_cross") {
      list = sortGoldenCrossItems(list);
    }
    return list;
  }, [baseFiltered, industryFilter, getItemIndustry, kindTab]);

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
      all: items.filter((it) => it.source === kindTab).length,
      kr: items.filter((it) => it.source === kindTab && it.market === "kr").length,
      us: items.filter((it) => it.source === kindTab && it.market === "us").length,
    }),
    [items, kindTab],
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
          onVaultChange?.(manualVaultSymbols(next));
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
    async (symbol: string, favorited: boolean) => {
      if (!authenticated) {
        setError(ko.stockVault.loginRequired);
        return;
      }
      const sym = symbol.trim().toUpperCase();
      setFavoriting(sym);
      setError(null);
      try {
        await setStockVaultFavorite(symbol, !favorited);
        setItems((prev) =>
          prev.map((it) =>
            it.symbol.trim().toUpperCase() === sym
              ? { ...it, favorited: !favorited }
              : it,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setFavoriting(null);
      }
    },
    [authenticated],
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
                onClick={() => void reload()}
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
          {scanNotice ? (
            <p className="stock-vault-tab__scan-notice">{scanNotice}</p>
          ) : null}
          {!authenticated ? (
            <p className="stock-vault-tab__desc">{ko.stockVault.loginHint}</p>
          ) : null}
        </header>

        <div className="stock-vault-tab__filters-wrap">
          <div
            className="stock-vault-tab__filters stock-vault-tab__filters--kind"
            role="tablist"
            aria-label={ko.stockVault.kindTabAria}
          >
            <div className="market-tabs">
              {(
                [
                  ["golden_cross", ko.stockVault.tabGolden, kindCounts.golden_cross],
                  ["ma_align", ko.stockVault.tabMaAlign, kindCounts.ma_align],
                  ["manual", ko.stockVault.tabManual, kindCounts.manual],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={kindTab === id}
                  className={kindTab === id ? "market-tab active" : "market-tab"}
                  onClick={() => {
                    setKindTab(id);
                    setIndustryFilter("all");
                  }}
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

        {loading ? (
          <p className="stock-vault-tab__muted">{ko.stockVault.loading}</p>
        ) : error ? (
          <p className="stock-vault-tab__error" role="alert">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="stock-vault-tab__muted">{ko.stockVault.empty}</p>
        ) : (
          <ul className="stock-vault-tab__list">
            {filtered.map((item) => {
              const symKey = item.symbol.trim().toUpperCase();
              const quote = quotes[symKey];
              const metaRow = meta[symKey];
              const display = resolveSymbolDisplayName(
                item.symbol,
                metaRow?.nameKo ?? item.name,
                item.market,
              );
              const industry = getItemIndustry(item);
              const tvSymbol =
                metaRow?.tvSymbol ??
                yahooStockSymbolToTradingView(
                  item.symbol,
                  item.market,
                  metaRow?.exchange,
                );
              const tvChartUrl = tradingViewChartUrl(tvSymbol);
              const cur =
                quote?.currency ?? (item.market === "kr" ? "KRW" : "USD");
              const chg = quote?.changePercent;
              const chgUp = chg != null && chg >= 0;
              const gcRecencyClass =
                item.source === "golden_cross"
                  ? goldenCrossRecencyClass(item)
                  : null;
              const rowClassName = [
                "stock-vault-tab__row",
                gcRecencyClass,
              ]
                .filter(Boolean)
                .join(" ");
              return (
              <li key={item.id} className={rowClassName}>
                <a
                  className="stock-vault-tab__row-link"
                  href={tvChartUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${display.label} ${ko.stockVault.openTradingViewChart}`}
                  title={ko.stockVault.openTradingViewChart}
                >
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
                    </div>
                    {industry ? (
                      <p className="stock-vault-tab__sector">{industry}</p>
                    ) : null}
                    <div className="stock-vault-tab__meta">
                      <span className="stock-vault-tab__market">
                        {item.market === "kr" ? ko.app.marketKr : ko.app.marketUs}
                      </span>
                      <span className="stock-vault-tab__source">
                        {item.source === "golden_cross"
                          ? ko.stockVault.sourceGolden
                          : item.source === "ma_align"
                            ? ko.stockVault.sourceMaAlign
                            : ko.stockVault.sourceManual}
                      </span>
                      {(item.crossDate ?? item.scanDate) ? (
                        <span className="stock-vault-tab__scan-date">
                          {item.crossDate ?? item.scanDate}
                        </span>
                      ) : null}
                      <span className="stock-vault-tab__added">
                        {fmtDate(item.updatedAtMs)}
                      </span>
                    </div>
                    {item.crosses?.length ? (
                      <div className="stock-vault-tab__crosses">
                        {item.crosses.map((c) => (
                          <span key={c} className="stock-vault-tab__cross">
                            {CROSS_LABEL[c] ?? c}
                          </span>
                        ))}
                      </div>
                    ) : item.source === "ma_align" ? (
                      <div className="stock-vault-tab__crosses">
                        <span className="stock-vault-tab__cross stock-vault-tab__cross--align">
                          {ko.stockVault.maAlignBadge}
                        </span>
                      </div>
                    ) : null}
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
                </a>
                <div className="stock-vault-tab__row-actions">
                  <button
                    type="button"
                    className={
                      item.favorited
                        ? "stock-vault-tab__favorite stock-vault-tab__favorite--on"
                        : "stock-vault-tab__favorite"
                    }
                    aria-label={
                      item.favorited
                        ? `${display.label} ${ko.stockVault.favoriteRemoveAria}`
                        : `${display.label} ${ko.stockVault.favoriteAddAria}`
                    }
                    title={
                      item.favorited
                        ? ko.stockVault.favoriteRemove
                        : ko.stockVault.favoriteAdd
                    }
                    aria-pressed={Boolean(item.favorited)}
                    disabled={favoriting === item.symbol}
                    onClick={() =>
                      void handleToggleFavorite(item.symbol, Boolean(item.favorited))
                    }
                  >
                    <VaultBookmarkIcon filled={Boolean(item.favorited)} />
                  </button>
                  <button
                    type="button"
                    className="stock-vault-tab__remove"
                    aria-label={`${display.label} ${ko.stockVault.removeAria}`}
                    title={ko.stockVault.remove}
                    disabled={removing === item.symbol || !authenticated}
                    onClick={() => void handleRemove(item.symbol)}
                  >
                    <span className="stock-vault-tab__remove-icon" aria-hidden>
                      ×
                    </span>
                    <span className="stock-vault-tab__remove-label">
                      {ko.stockVault.remove}
                    </span>
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
