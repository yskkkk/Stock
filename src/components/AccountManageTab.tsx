import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchSp500Sectors,
  fetchTossHoldingsManage,
  type TossTestHolding,
} from "../api";
import { ko } from "../i18n/ko";
import {
  accountSlicesToDonut,
  accountSymbolSliceLabel,
  buildAccountAllocationSlices,
  tossHoldingsToAccountRows,
  type AccountAllocMode,
  type AccountHoldingRow,
} from "../lib/accountAllocation";
import {
  donutArcPath,
  donutArcPathPopOut,
  fmtSectorPct,
} from "../lib/sp500SectorChart";
import {
  mergeTossFeeRates,
  tossFeeRatesFromLegacy,
} from "../lib/tossHoldingFeeRates";
import {
  computeTossAccountCombinedPnl,
  tossHoldingsTotalNetMarketValueKrw,
} from "../lib/tossHoldingPnl";
import { formatPercent, formatSignedMoney } from "../lib/format";
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import {
  TOSS_LEDGER_POLL_MS,
  useTossAccountSnapshot,
} from "../hooks/useTossAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import { useTossSnapshotLiveQuotes } from "../hooks/useTossSnapshotLiveQuotes";
import LiveTradeAuthPanel, {
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import LiveTradeApiNotConnectedNotice from "./LiveTradeApiNotConnectedNotice";
import TossAccountSnapshotCard from "./TossAccountSnapshotCard";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import TossHoldingManageModal from "./TossHoldingManageModal";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import "./account-manage-tab.css";

type PanelTab = "chart" | "list";

function formatKrw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function formatAllocPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.1) return `${n.toFixed(2)}%`;
  return fmtSectorPct(n);
}

export default function AccountManageTab({
  onOpenHoldingChart,
}: {
  onOpenHoldingChart?: (h: TossTestHolding) => void;
}) {
  const { user, registrationOpen, authChecked, refreshAuth } = useLiveTradeAuth();
  const status = useLiveTradingStatusPoll();
  const tossReady = Boolean(status?.toss?.ready);
  const bithumbReady = Boolean(status?.bithumb?.ready);

  const [provider, setProvider] = useState<LiveTradeTradesExchange>(() =>
    tossReady ? "toss" : bithumbReady ? "bithumb" : "toss",
  );
  const [panelTab, setPanelTab] = useState<PanelTab>("chart");
  const [allocMode, setAllocMode] = useState<AccountAllocMode>("symbol");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [manageHolding, setManageHolding] = useState<TossTestHolding | null>(null);
  const [enrichMap, setEnrichMap] = useState<
    Map<
      string,
      {
        industry?: string | null;
        subIndustry?: string | null;
        sectorEn?: string | null;
        sectorKo?: string | null;
      }
    >
  >(() => new Map());
  const [hoverBubble, setHoverBubble] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  const wheelRef = useRef<HTMLElement | null>(null);
  const [balanceHidden, toggleBalanceHidden] = useBithumbBalanceHidden();

  useEffect(() => {
    if (tossReady && !bithumbReady) setProvider("toss");
    else if (bithumbReady && !tossReady) setProvider("bithumb");
  }, [tossReady, bithumbReady]);

  const {
    snapshot: tossSnapshot,
    feeLabelKo: tossFeeLabelHook,
    tossRoundTripFeeRate: tossRoundTripFeeRateHook,
    tossFeeRatesByMarket: tossFeeRatesByMarketHook,
    updatedAtMs: tossUpdatedAtMs,
    loading: tossLoading,
    err: tossErr,
    reload: reloadToss,
  } = useTossAccountSnapshot({
    poll: Boolean(user) && provider === "toss",
    pollIntervalMs: TOSS_LEDGER_POLL_MS,
  });

  const {
    snapshot: bithumbSnapshot,
    feeLabelKo: bithumbFeeLabel,
    updatedAtMs: bithumbUpdatedAtMs,
    loading: bithumbLoading,
    err: bithumbErr,
    reload: reloadBithumb,
  } = useBithumbAccountSnapshot({
    poll: Boolean(user) && provider === "bithumb",
  });

  const tossFeeRatesByMarket = useMemo(() => {
    const fromStatus = status?.feeRates?.toss;
    if (fromStatus) {
      return {
        kr: fromStatus.krRoundTripFeeRate ?? fromStatus.roundTripFeeRate,
        us: fromStatus.usRoundTripFeeRate ?? fromStatus.roundTripFeeRate,
        source: fromStatus.source,
      };
    }
    return mergeTossFeeRates(
      tossFeeRatesByMarketHook,
      tossFeeRatesFromLegacy(tossRoundTripFeeRateHook, tossFeeRatesByMarketHook?.source),
    );
  }, [status?.feeRates?.toss, tossFeeRatesByMarketHook, tossRoundTripFeeRateHook]);

  const feeRates = tossFeeRatesByMarket;
  const liveSnapshot = useTossSnapshotLiveQuotes(
    tossSnapshot,
    Boolean(user && provider === "toss" && tossSnapshot?.holdings?.length),
    undefined,
    feeRates,
  );
  const activeToss = liveSnapshot ?? tossSnapshot;
  const needsFx = Boolean(
    activeToss &&
      (activeToss.cash.usd > 0 ||
        activeToss.holdings.some((h) => h.market === "us" || h.currency === "USD")),
  );
  const { rate: usdKrwRate } = useUsdKrwRate(needsFx);

  // 업종·S&P GICS·상세업종 보강
  useEffect(() => {
    if (!user || provider !== "toss" || !activeToss?.holdings?.length) return;
    let cancelled = false;
    void (async () => {
      const map = new Map<
        string,
        {
          industry?: string | null;
          subIndustry?: string | null;
          sectorEn?: string | null;
          sectorKo?: string | null;
        }
      >();
      try {
        const [manage, sp500] = await Promise.all([
          fetchTossHoldingsManage().catch(() => null),
          fetchSp500Sectors().catch(() => null),
        ]);
        if (cancelled) return;
        const gics = new Map<
          string,
          { sector: string; sectorKo: string; subIndustry: string }
        >();
        for (const c of sp500?.companies ?? []) {
          gics.set(String(c.symbol).toUpperCase(), {
            sector: c.sector,
            sectorKo: c.sectorKo || c.sector,
            subIndustry: String(c.subIndustry ?? "").trim(),
          });
        }
        for (const h of manage?.holdings ?? []) {
          const sym = String(h.symbol ?? "").toUpperCase();
          const g = gics.get(sym);
          const industry = h.industry ?? null;
          map.set(sym, {
            industry,
            // 상세: Yahoo/Naver 업종 우선, 없으면 S&P subIndustry
            subIndustry: industry || g?.subIndustry || null,
            sectorEn: g?.sector ?? null,
            sectorKo: g?.sectorKo ?? industry ?? null,
          });
        }
        for (const h of activeToss.holdings) {
          const sym = String(h.symbol ?? "").toUpperCase();
          if (map.has(sym)) continue;
          const g = gics.get(sym);
          if (g) {
            map.set(sym, {
              industry: g.subIndustry || g.sectorKo,
              subIndustry: g.subIndustry || g.sectorKo,
              sectorEn: g.sector,
              sectorKo: g.sectorKo,
            });
          }
        }
        setEnrichMap(map);
      } catch {
        if (!cancelled) setEnrichMap(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, provider, activeToss?.holdings]);

  const holdingRows: AccountHoldingRow[] = useMemo(() => {
    if (provider === "toss" && activeToss) {
      return tossHoldingsToAccountRows(
        activeToss.holdings,
        usdKrwRate,
        feeRates,
        enrichMap,
      );
    }
    if (provider === "bithumb" && bithumbSnapshot) {
      return (bithumbSnapshot.holdings ?? []).map((h) => {
        const sym = h.symbol || h.currency;
        const { label: cryptoName } = resolveSymbolDisplayName(sym, h.symbol, "crypto");
        const mv =
          h.marketValue != null && Number.isFinite(h.marketValue) && h.marketValue > 0
            ? h.marketValue
            : h.currentPrice != null && h.quantity > 0
              ? h.currentPrice * h.quantity
              : 0;
        return {
          symbol: sym,
          name: cryptoName || sym,
          market: "crypto" as const,
          currency: h.currency,
          quantity: h.quantity,
          valueKrw: mv,
          returnPercent:
            h.returnPercent != null && Number.isFinite(h.returnPercent)
              ? h.returnPercent
              : null,
          industry: null,
          subIndustry: null,
          sectorEn: null,
          sectorKo: null,
        };
      });
    }
    return [];
  }, [provider, activeToss, bithumbSnapshot, usdKrwRate, feeRates, enrichMap]);

  const cashKrw = useMemo(() => {
    if (provider === "toss" && activeToss) {
      const krw = activeToss.cash.krw ?? 0;
      const usd = activeToss.cash.usd ?? 0;
      const fx =
        usdKrwRate != null && Number.isFinite(usdKrwRate) && usdKrwRate > 0
          ? usd * usdKrwRate
          : 0;
      return krw + fx;
    }
    if (provider === "bithumb" && bithumbSnapshot) {
      return Number(bithumbSnapshot.krw?.total) || 0;
    }
    return 0;
  }, [provider, activeToss, bithumbSnapshot, usdKrwRate]);

  const labels = useMemo(
    () => ({
      cash: ko.app.accountManageCash,
      other: ko.app.accountManageOther,
      marketKr: ko.app.accountManageMarketKr,
      marketUs: ko.app.accountManageMarketUs,
      marketCrypto: ko.app.accountManageMarketCrypto,
    }),
    [],
  );

  const slices = useMemo(
    () => buildAccountAllocationSlices(holdingRows, cashKrw, allocMode, labels),
    [holdingRows, cashKrw, allocMode, labels],
  );

  const { segments, total } = useMemo(
    () => accountSlicesToDonut(slices),
    [slices],
  );

  const filteredRows = useMemo(() => {
    if (!focusKey) return holdingRows;
    if (focusKey === "__cash__") return [];
    const slice = slices.find((s) => s.key === focusKey);
    if (!slice) return holdingRows;
    const set = new Set(slice.symbols.map((s) => s.toUpperCase()));
    return holdingRows.filter((r) => set.has(r.symbol.toUpperCase()));
  }, [focusKey, holdingRows, slices]);

  const netSummary = useMemo(() => {
    if (provider !== "toss" || !activeToss) return null;
    return computeTossAccountCombinedPnl(
      activeToss.holdings,
      activeToss.summary,
      usdKrwRate,
      feeRates,
    );
  }, [provider, activeToss, usdKrwRate, feeRates]);

  const holdingsTotalKrw = useMemo(() => {
    if (provider === "toss" && activeToss) {
      return tossHoldingsTotalNetMarketValueKrw(
        activeToss.holdings,
        activeToss.summary,
        usdKrwRate,
        feeRates,
      );
    }
    return holdingRows.reduce((s, r) => s + r.valueKrw, 0);
  }, [provider, activeToss, usdKrwRate, feeRates, holdingRows]);

  const holdingsReturnPct = useMemo(() => {
    if (netSummary?.totalReturnPct != null && Number.isFinite(netSummary.totalReturnPct)) {
      return netSummary.totalReturnPct;
    }
    let weighted = 0;
    let weightSum = 0;
    for (const r of holdingRows) {
      if (r.returnPercent == null || !Number.isFinite(r.returnPercent)) continue;
      const w = r.valueKrw > 0 ? r.valueKrw : 0;
      if (w <= 0) continue;
      weighted += r.returnPercent * w;
      weightSum += w;
    }
    if (weightSum <= 0) return null;
    return weighted / weightSum;
  }, [netSummary, holdingRows]);

  const onRefresh = useCallback(() => {
    if (provider === "toss") void reloadToss?.(true);
    else void reloadBithumb?.(true);
  }, [provider, reloadToss, reloadBithumb]);

  const showHoverBubble = useCallback(
    (key: string, clientX: number, clientY: number) => {
      const root = wheelRef.current;
      if (!root) {
        setHoverBubble({ key, x: clientX, y: clientY });
        return;
      }
      const rect = root.getBoundingClientRect();
      setHoverBubble({
        key,
        x: clientX - rect.left,
        y: clientY - rect.top,
      });
    },
    [],
  );

  const hideHoverBubble = useCallback(() => {
    setHoverBubble(null);
    setHoveredKey(null);
  }, []);

  const hoverSlice = hoverBubble
    ? slices.find((s) => s.key === hoverBubble.key)
    : null;
  const hoverSeg = hoverBubble
    ? segments.find((s) => s.sector === hoverBubble.key)
    : null;
  const hoverRows = useMemo(() => {
    if (!hoverSlice) return [];
    const set = new Set(hoverSlice.symbols.map((s) => s.toUpperCase()));
    return holdingRows.filter((r) => set.has(r.symbol.toUpperCase())).slice(0, 6);
  }, [hoverSlice, holdingRows]);

  const cx = 100;
  const cy = 100;
  const r0 = 52;
  const r1 = 88;

  if (!authChecked) {
    return (
      <div className="account-manage-tab" aria-label={ko.app.accountManageAria}>
        <DockPanelCenterLoading label={ko.app.accountManageLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="account-manage-tab" aria-label={ko.app.accountManageAria}>
        <header className="account-manage-tab__head">
          <h2 className="account-manage-tab__title">{ko.app.accountManageTitle}</h2>
          <p className="account-manage-tab__sub">{ko.app.accountManageLoginHint}</p>
        </header>
        <LiveTradeAuthPanel
          user={null}
          registrationOpen={registrationOpen}
          onAuthChange={() => void refreshAuth()}
          variant="card"
        />
      </div>
    );
  }

  const loading =
    provider === "toss" ? tossLoading && !tossSnapshot : bithumbLoading && !bithumbSnapshot;
  const err = provider === "toss" ? tossErr : bithumbErr;
  const ready = provider === "toss" ? tossReady : bithumbReady;
  const updatedAtMs = provider === "toss" ? tossUpdatedAtMs : bithumbUpdatedAtMs;

  return (
    <div
      className={[
        "account-manage-tab",
        balanceHidden ? "account-manage-tab--balance-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ko.app.accountManageAria}
    >
      <header className="account-manage-tab__head">
        <div>
          <h2 className="account-manage-tab__title">{ko.app.accountManageTitle}</h2>
          <p className="account-manage-tab__sub">
            {ko.app.accountManageSubtitle}
            {user.email ? ` · ${user.email}` : ""}
          </p>
        </div>
        <div className="account-manage-tab__head-actions">
          <button
            type="button"
            className="bithumb-balance-hide-btn account-manage-tab__hide-btn"
            onClick={toggleBalanceHidden}
            aria-pressed={balanceHidden}
            title={
              balanceHidden
                ? ko.app.accountManageMoneyShow
                : ko.app.accountManageMoneyHide
            }
          >
            {balanceHidden
              ? ko.app.accountManageMoneyShow
              : ko.app.accountManageMoneyHide}
          </button>
          <button
            type="button"
            className="btn btn--secondary account-manage-tab__refresh"
            onClick={onRefresh}
            disabled={loading}
          >
            {ko.app.accountManageRefresh}
          </button>
        </div>
      </header>

      <div className="account-manage-tab__exchange">
        <LiveTradeExchangePicker
          selected={provider}
          onSelect={setProvider}
          compact
        />
      </div>

      {!ready ? (
        <LiveTradeApiNotConnectedNotice exchange={provider} />
      ) : loading ? (
        <DockPanelCenterLoading label={ko.app.accountManageLoading} />
      ) : err ? (
        <p className="account-manage-tab__error" role="alert">
          {err}
        </p>
      ) : (
        <>
          <div className="account-manage-tab__summary-wrap">
            <div className="account-manage-tab__summary-toolbar">
              <button
                type="button"
                className="bithumb-balance-hide-btn account-manage-tab__hide-btn account-manage-tab__hide-btn--summary"
                onClick={toggleBalanceHidden}
                aria-pressed={balanceHidden}
              >
                {balanceHidden
                  ? ko.app.accountManageMoneyShow
                  : ko.app.accountManageMoneyHide}
              </button>
            </div>
          <div className="account-manage-tab__summary">
            <div className="account-manage-tab__stat">
              <span className="account-manage-tab__stat-label">
                {ko.app.accountManageTotal}
              </span>
              <span className="account-manage-tab__stat-value">
                <span
                  className="account-manage-tab__money"
                  aria-hidden={balanceHidden || undefined}
                >
                  {formatKrw((holdingsTotalKrw ?? 0) + cashKrw)}
                </span>
              </span>
            </div>
            <div className="account-manage-tab__stat">
              <span className="account-manage-tab__stat-label">
                {ko.app.accountManageHoldings}
              </span>
              <span
                className={[
                  "account-manage-tab__stat-value",
                  holdingsReturnPct != null && holdingsReturnPct > 0
                    ? "is-up"
                    : holdingsReturnPct != null && holdingsReturnPct < 0
                      ? "is-down"
                      : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span
                  className="account-manage-tab__money"
                  aria-hidden={balanceHidden || undefined}
                >
                  {formatKrw(holdingsTotalKrw)}
                </span>
                {holdingsReturnPct != null ? (
                  <span className="account-manage-tab__stat-pct">
                    {" "}
                    ({formatPercent(holdingsReturnPct)})
                  </span>
                ) : null}
              </span>
            </div>
            <div className="account-manage-tab__stat">
              <span className="account-manage-tab__stat-label">
                {ko.app.accountManageCash}
              </span>
              <span className="account-manage-tab__stat-value">
                <span
                  className="account-manage-tab__money"
                  aria-hidden={balanceHidden || undefined}
                >
                  {formatKrw(cashKrw)}
                </span>
              </span>
            </div>
            {netSummary?.profitLossKrw != null ? (
              <div className="account-manage-tab__stat">
                <span className="account-manage-tab__stat-label">
                  {ko.app.liveTradePfUnrealized}
                </span>
                <span
                  className={[
                    "account-manage-tab__stat-value",
                    netSummary.profitLossKrw > 0
                      ? "is-up"
                      : netSummary.profitLossKrw < 0
                        ? "is-down"
                        : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span
                    className="account-manage-tab__money"
                    aria-hidden={balanceHidden || undefined}
                  >
                    {formatSignedMoney(netSummary.profitLossKrw, "KRW")}
                    {netSummary.totalReturnPct != null
                      ? ` (${formatPercent(netSummary.totalReturnPct)})`
                      : ""}
                  </span>
                </span>
              </div>
            ) : null}
            {updatedAtMs ? (
              <div className="account-manage-tab__stat account-manage-tab__stat--muted">
                <span className="account-manage-tab__stat-label">
                  {ko.app.accountManageUpdated}
                </span>
                <span className="account-manage-tab__stat-value">
                  {new Date(updatedAtMs).toLocaleTimeString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })}
                </span>
              </div>
            ) : null}
          </div>
          </div>

          <div className="account-manage-tab__grid">
            <aside
              ref={wheelRef}
              className="account-manage-tab__wheel card"
              aria-label={ko.app.accountManageChartTitle}
            >
              <div className="account-manage-tab__wheel-head">
                <div>
                  <h3 className="account-manage-tab__wheel-title">
                    {ko.app.accountManageChartTitle}
                  </h3>
                  <p className="account-manage-tab__wheel-sub">
                    {ko.app.accountManageChartBasis} ·{" "}
                    <span
                      className="account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {formatKrw(total)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="account-manage-tab__mode" role="group">
                {(
                  [
                    ["symbol", ko.app.accountManageGroupSymbol],
                    ["sector", ko.app.accountManageGroupSector],
                    ["subIndustry", ko.app.accountManageGroupSubIndustry],
                    ["market", ko.app.accountManageGroupMarket],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={
                      allocMode === id
                        ? "account-manage-tab__mode-btn active"
                        : "account-manage-tab__mode-btn"
                    }
                    onClick={() => {
                      setAllocMode(id);
                      setFocusKey(null);
                      hideHoverBubble();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="account-manage-tab__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={
                    panelTab === "chart"
                      ? "account-manage-tab__tab active"
                      : "account-manage-tab__tab"
                  }
                  aria-selected={panelTab === "chart"}
                  onClick={() => setPanelTab("chart")}
                >
                  {ko.app.accountManageTabChart}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={
                    panelTab === "list"
                      ? "account-manage-tab__tab active"
                      : "account-manage-tab__tab"
                  }
                  aria-selected={panelTab === "list"}
                  onClick={() => setPanelTab("list")}
                >
                  {ko.app.accountManageTabList}
                </button>
              </div>

              {segments.length === 0 ? (
                <p className="account-manage-tab__empty">{ko.app.accountManageEmpty}</p>
              ) : panelTab === "chart" ? (
                <div className="account-manage-tab__chart-panel">
                  <svg
                    className="account-manage-tab__svg"
                    viewBox="0 0 200 200"
                    role="img"
                    aria-hidden="true"
                  >
                    {[...segments]
                      .sort((a, b) => {
                        const aLift = hoveredKey === a.sector || focusKey === a.sector ? 1 : 0;
                        const bLift = hoveredKey === b.sector || focusKey === b.sector ? 1 : 0;
                        return aLift - bLift;
                      })
                      .map((seg) => {
                        const lifted =
                          hoveredKey === seg.sector || focusKey === seg.sector;
                        const dimmed = focusKey && focusKey !== seg.sector;
                        return (
                          <path
                            key={seg.sector}
                            className={[
                              "account-manage-tab__seg",
                              lifted ? "account-manage-tab__seg--lifted" : "",
                              dimmed ? "account-manage-tab__seg--dim" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            d={
                              lifted
                                ? donutArcPathPopOut(cx, cy, r0, r1, seg.a0, seg.a1)
                                : donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)
                            }
                            fill={seg.color}
                            onClick={() =>
                              setFocusKey((prev) =>
                                prev === seg.sector ? null : seg.sector,
                              )
                            }
                            onMouseEnter={(e) => {
                              setHoveredKey(seg.sector);
                              showHoverBubble(seg.sector, e.clientX, e.clientY);
                            }}
                            onMouseMove={(e) => {
                              showHoverBubble(seg.sector, e.clientX, e.clientY);
                            }}
                            onMouseLeave={hideHoverBubble}
                          />
                        );
                      })}
                    <circle cx={cx} cy={cy} r={r0 - 2} className="account-manage-tab__hole" />
                    <text
                      x={cx}
                      y={cy - 4}
                      textAnchor="middle"
                      className="account-manage-tab__center-label"
                    >
                      {focusKey
                        ? segments.find((s) => s.sector === focusKey)?.sectorKo ?? ""
                        : ko.app.accountManageTotal}
                    </text>
                    <text
                      x={cx}
                      y={cy + 14}
                      textAnchor="middle"
                      className="account-manage-tab__center-pct"
                    >
                      {focusKey
                        ? formatAllocPct(
                            segments.find((s) => s.sector === focusKey)?.pct ?? 0,
                          )
                        : formatAllocPct(100)}
                    </text>
                  </svg>
                  <ul className="account-manage-tab__legend">
                    {segments.map((seg) => {
                      const slice = slices.find((s) => s.key === seg.sector);
                      return (
                        <li key={seg.sector}>
                          <button
                            type="button"
                            className={[
                              "account-manage-tab__legend-btn",
                              focusKey === seg.sector ? "active" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() =>
                              setFocusKey((prev) =>
                                prev === seg.sector ? null : seg.sector,
                              )
                            }
                            onMouseEnter={(e) => {
                              setHoveredKey(seg.sector);
                              showHoverBubble(seg.sector, e.clientX, e.clientY);
                            }}
                            onMouseMove={(e) => {
                              showHoverBubble(seg.sector, e.clientX, e.clientY);
                            }}
                            onMouseLeave={hideHoverBubble}
                          >
                            <span
                              className="account-manage-tab__swatch"
                              style={{ background: seg.color }}
                            />
                            <span className="account-manage-tab__legend-name">
                              {seg.sectorKo}
                            </span>
                            <span className="account-manage-tab__legend-pct">
                              {formatAllocPct(seg.pct)}
                            </span>
                            <span
                              className="account-manage-tab__legend-val account-manage-tab__money"
                              aria-hidden={balanceHidden || undefined}
                            >
                              {formatKrw(slice?.valueKrw)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <ul className="account-manage-tab__slice-list">
                  {segments.map((seg) => {
                    const slice = slices.find((s) => s.key === seg.sector);
                    return (
                      <li
                        key={seg.sector}
                        className="account-manage-tab__slice-row"
                        onMouseEnter={(e) => {
                          setHoveredKey(seg.sector);
                          showHoverBubble(seg.sector, e.clientX, e.clientY);
                        }}
                        onMouseMove={(e) => {
                          showHoverBubble(seg.sector, e.clientX, e.clientY);
                        }}
                        onMouseLeave={hideHoverBubble}
                        onClick={() =>
                          setFocusKey((prev) =>
                            prev === seg.sector ? null : seg.sector,
                          )
                        }
                      >
                        <span
                          className="account-manage-tab__swatch"
                          style={{ background: seg.color }}
                        />
                        <span className="account-manage-tab__slice-name">
                          {seg.sectorKo}
                        </span>
                        <span className="account-manage-tab__slice-meta">
                          {seg.sector === "__cash__"
                            ? ""
                            : ko.app.accountManageSliceCount.replace(
                                "{n}",
                                String(seg.count),
                              )}
                        </span>
                        <span>{formatAllocPct(seg.pct)}</span>
                        <span
                          className="account-manage-tab__money"
                          aria-hidden={balanceHidden || undefined}
                        >
                          {formatKrw(slice?.valueKrw)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {hoverBubble && hoverSlice && hoverSeg ? (
                <div
                  className="account-manage-tab__bubble"
                  style={{
                    left: Math.min(
                      Math.max(12, hoverBubble.x + 14),
                      (wheelRef.current?.clientWidth ?? 320) - 200,
                    ),
                    top: Math.max(8, hoverBubble.y - 12),
                  }}
                  role="tooltip"
                >
                  <div className="account-manage-tab__bubble-head">
                    <span
                      className="account-manage-tab__swatch"
                      style={{ background: hoverSeg.color }}
                    />
                    <strong>{hoverSlice.label}</strong>
                  </div>
                  <div className="account-manage-tab__bubble-row">
                    <span>{ko.app.accountManageSliceValue}</span>
                    <span
                      className="account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {formatKrw(hoverSlice.valueKrw)}
                    </span>
                  </div>
                  <div className="account-manage-tab__bubble-row">
                    <span>비중</span>
                    <span>{formatAllocPct(hoverSeg.pct)}</span>
                  </div>
                  {hoverSlice.key !== "__cash__" ? (
                    <div className="account-manage-tab__bubble-row">
                      <span>{ko.app.accountManageHoldings}</span>
                      <span>
                        {ko.app.accountManageSliceCount.replace(
                          "{n}",
                          String(hoverSlice.count),
                        )}
                      </span>
                    </div>
                  ) : null}
                  {hoverRows.length > 0 ? (
                    <div className="account-manage-tab__bubble-syms">
                      <div className="account-manage-tab__bubble-syms-label">
                        {ko.app.accountManageBubbleSymbols}
                      </div>
                      <ul>
                        {hoverRows.map((r) => (
                          <li key={r.symbol}>
                            <span>
                              {accountSymbolSliceLabel(r, r.symbol)}
                            </span>
                            <span
                              className="account-manage-tab__money"
                              aria-hidden={balanceHidden || undefined}
                            >
                              {formatKrw(r.valueKrw)}
                            </span>
                          </li>
                        ))}
                        {hoverSlice.symbols.length > hoverRows.length ? (
                          <li className="account-manage-tab__bubble-more">
                            외 {hoverSlice.symbols.length - hoverRows.length}종목
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {focusKey ? (
                <button
                  type="button"
                  className="account-manage-tab__clear"
                  onClick={() => setFocusKey(null)}
                >
                  {ko.app.accountManageClearFilter}
                </button>
              ) : (
                <p className="account-manage-tab__hint">
                  {ko.app.accountManagePickHint} {ko.app.accountManageHoverHint}
                </p>
              )}
            </aside>

            <section className="account-manage-tab__holdings card">
              <h3 className="account-manage-tab__holdings-title">
                {focusKey
                  ? segments.find((s) => s.sector === focusKey)?.sectorKo ??
                    ko.app.accountManageTabList
                  : ko.app.accountManageTabList}
              </h3>
              {filteredRows.length === 0 ? (
                <p className="account-manage-tab__empty">
                  {focusKey === "__cash__" ? (
                    <span
                      className="account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {formatKrw(cashKrw)}
                    </span>
                  ) : (
                    ko.app.accountManageEmpty
                  )}
                </p>
              ) : (
                <div className="account-manage-tab__table-wrap">
                  <table className="account-manage-tab__table">
                    <thead>
                      <tr>
                        <th>{ko.app.liveTradePfColSymbol}</th>
                        <th>
                          {allocMode === "subIndustry"
                            ? ko.app.accountManageGroupSubIndustry
                            : allocMode === "symbol"
                              ? ko.app.accountManageGroupMarket
                              : ko.app.accountManageGroupSector}
                        </th>
                        <th>{ko.app.liveTradePfColQty}</th>
                        <th>{ko.app.accountManageSliceValue}</th>
                        <th>{ko.app.liveTradePfReturn}</th>
                        {provider === "toss" ? <th /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => {
                        const raw =
                          provider === "toss"
                            ? activeToss?.holdings.find(
                                (h) =>
                                  h.symbol.toUpperCase() === row.symbol.toUpperCase(),
                              )
                            : null;
                        return (
                          <tr key={`${row.market}:${row.symbol}`}>
                            <td>
                              <button
                                type="button"
                                className="account-manage-tab__sym-btn"
                                title={
                                  onOpenHoldingChart
                                    ? ko.app.liveTradeChartOpenLookup
                                    : undefined
                                }
                                disabled={!onOpenHoldingChart}
                                onClick={() => {
                                  if (!onOpenHoldingChart) return;
                                  if (raw) {
                                    onOpenHoldingChart(raw);
                                    return;
                                  }
                                  if (row.market !== "kr" && row.market !== "us") return;
                                  onOpenHoldingChart({
                                    symbol: row.symbol,
                                    name: row.name,
                                    market: row.market,
                                    currency: row.market === "us" ? "USD" : "KRW",
                                    quantity: row.quantity,
                                    avgBuyPrice: null,
                                    returnPercent: row.returnPercent,
                                  });
                                }}
                              >
                                <strong>{row.symbol}</strong>
                                <div className="account-manage-tab__name">{row.name}</div>
                              </button>
                            </td>
                            <td>
                              {allocMode === "symbol"
                                ? row.market === "us"
                                  ? labels.marketUs
                                  : row.market === "crypto"
                                    ? labels.marketCrypto
                                    : labels.marketKr
                                : allocMode === "subIndustry"
                                  ? row.subIndustry || row.industry || row.sectorKo || "—"
                                  : row.sectorKo || row.industry || "—"}
                            </td>
                            <td>{row.quantity}</td>
                            <td>
                              <span
                                className="account-manage-tab__money"
                                aria-hidden={balanceHidden || undefined}
                              >
                                {formatKrw(row.valueKrw)}
                              </span>
                            </td>
                            <td
                              className={
                                row.returnPercent != null && row.returnPercent > 0
                                  ? "is-up"
                                  : row.returnPercent != null && row.returnPercent < 0
                                    ? "is-down"
                                    : ""
                              }
                            >
                              {row.returnPercent != null
                                ? formatPercent(row.returnPercent)
                                : "—"}
                            </td>
                            {provider === "toss" && raw ? (
                              <td>
                                <button
                                  type="button"
                                  className="btn btn--ghost account-manage-tab__manage-btn"
                                  onClick={() => setManageHolding(raw)}
                                >
                                  관리
                                </button>
                              </td>
                            ) : provider === "toss" ? (
                              <td />
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <details className="account-manage-tab__raw card">
            <summary>계좌 상세(잔고·주문)</summary>
            {provider === "toss" && activeToss ? (
              <TossAccountSnapshotCard
                snapshot={activeToss}
                feeLabelKo={
                  status?.feeRates?.toss?.labelKo?.trim() || tossFeeLabelHook || null
                }
                tossRoundTripFeeRate={
                  status?.feeRates?.toss?.roundTripFeeRate ??
                  tossRoundTripFeeRateHook ??
                  null
                }
                tossFeeRatesByMarket={feeRates}
                updatedAtMs={tossUpdatedAtMs}
                authenticated
                showOrders
                onOpenHoldingChart={onOpenHoldingChart}
              />
            ) : provider === "bithumb" && bithumbSnapshot ? (
              <BithumbAccountSnapshotCard
                snapshot={bithumbSnapshot}
                feeLabelKo={bithumbFeeLabel}
                updatedAtMs={bithumbUpdatedAtMs}
                variant="inline"
              />
            ) : null}
          </details>
        </>
      )}

      {manageHolding ? (
        <TossHoldingManageModal
          holding={manageHolding}
          onClose={() => setManageHolding(null)}
        />
      ) : null}
    </div>
  );
}
