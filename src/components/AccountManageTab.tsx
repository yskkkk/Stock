import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAccountHoldingStyle,
  fetchSp500Sectors,
  fetchTossHoldingsManage,
  putAccountHoldingStyleOverride,
  runTossRebalanceNow,
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
  type AccountHoldingStyle,
} from "../lib/accountAllocation";
import {
  normalizeAccountStyleTicker,
  resolveAccountHoldingStyle,
} from "../../shared/account-holding-style-policy.js";
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
import { formatPercent, formatPrice, formatSignedMoney } from "../lib/format";
import { anySelectedMarketRegularOpen, isMarketRegularOpenClient } from "../lib/marketRegularHours";
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import {
  useAccountManageDisplayCurrency,
  type AccountManageDisplayCurrency,
} from "../hooks/useAccountManageDisplayCurrency";
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
import AccountRebalanceScheduleModal from "./AccountRebalanceScheduleModal";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import "./account-manage-tab.css";
import "./account-rebalance-schedule-modal.css";

type PanelTab = "chart" | "list";

function krwToDisplay(
  n: number | null | undefined,
  currency: AccountManageDisplayCurrency,
  usdKrwRate: number | null,
): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (currency === "KRW") return n;
  if (!(usdKrwRate != null && Number.isFinite(usdKrwRate) && usdKrwRate > 0)) {
    return null;
  }
  return n / usdKrwRate;
}

function formatAccountMoney(
  n: number | null | undefined,
  currency: AccountManageDisplayCurrency,
  usdKrwRate: number | null,
): string {
  const v = krwToDisplay(n, currency, usdKrwRate);
  if (v == null) return "?";
  return formatPrice(v, currency);
}

function formatAccountSignedMoney(
  n: number | null | undefined,
  currency: AccountManageDisplayCurrency,
  usdKrwRate: number | null,
): string {
  const v = krwToDisplay(n, currency, usdKrwRate);
  if (v == null) return "?";
  return formatSignedMoney(v, currency);
}

function formatAllocPct(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (n > 0 && n < 0.1) return `${n.toFixed(2)}%`;
  return fmtSectorPct(n);
}

function accountCashStatAria(
  label: string,
  formattedAmount: string,
  balanceHidden: boolean,
  summaryPending: boolean,
  extra?: string,
): string {
  if (summaryPending) return `${label}, ${ko.app.accountManageLoading}`;
  if (balanceHidden) return `${label}, ${ko.app.accountManageCashStatHidden}`;
  const base = `${label}, ${formattedAmount}`;
  return extra ? `${base}, ${extra}` : base;
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
  const [styleFocusKey, setStyleFocusKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [styleHoveredKey, setStyleHoveredKey] = useState<string | null>(null);
  const [styleOverrides, setStyleOverrides] = useState<
    Record<string, AccountHoldingStyle>
  >({});
  const [stylePolicyLines, setStylePolicyLines] = useState<string[]>([]);
  const [styleSavingSym, setStyleSavingSym] = useState<string | null>(null);
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
  const [displayCurrency, setDisplayCurrency] = useAccountManageDisplayCurrency();
  const [rebalanceOpen, setRebalanceOpen] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, setHoursTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setHoursTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
  const { snapshot: liveSnapshot, quotesUpdatedAtMs } = useTossSnapshotLiveQuotes(
    tossSnapshot,
    Boolean(user && provider === "toss" && tossSnapshot?.holdings?.length),
    undefined,
    feeRates,
  );
  const activeToss = liveSnapshot ?? tossSnapshot;
  const { rate: usdKrwRate } = useUsdKrwRate(Boolean(user));
  const money = useCallback(
    (n: number | null | undefined) =>
      formatAccountMoney(n, displayCurrency, usdKrwRate),
    [displayCurrency, usdKrwRate],
  );
  const signedMoney = useCallback(
    (n: number | null | undefined) =>
      formatAccountSignedMoney(n, displayCurrency, usdKrwRate),
    [displayCurrency, usdKrwRate],
  );

  // ????? ??(????) ? ????? ?? ??? ??
  useEffect(() => {
    if (!user) {
      setStyleOverrides({});
      setStylePolicyLines([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await fetchAccountHoldingStyle();
        if (cancelled || !snap?.ok) return;
        setStyleOverrides(snap.overrides ?? {});
        setStylePolicyLines(
          Array.isArray(snap.policy?.priority) ? snap.policy.priority : [],
        );
      } catch {
        if (!cancelled) {
          setStyleOverrides({});
          setStylePolicyLines([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onSetHoldingStyle = useCallback(
    async (symbol: string, next: AccountHoldingStyle | "auto") => {
      const sym = String(symbol || "").trim();
      if (!sym || styleSavingSym) return;
      setStyleSavingSym(sym);
      try {
        const style = next === "auto" ? null : next;
        const snap = await putAccountHoldingStyleOverride(sym, style);
        if (snap?.ok && snap.overrides) {
          setStyleOverrides(snap.overrides);
        }
      } catch {
        /* keep previous */
      } finally {
        setStyleSavingSym(null);
      }
    },
    [styleSavingSym],
  );

  // ???S&P GICS????? ??
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
            // ??: Yahoo/Naver ?? ??, ??? S&P subIndustry
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
        const cost =
          h.avgBuyPrice != null &&
          Number.isFinite(h.avgBuyPrice) &&
          h.avgBuyPrice > 0 &&
          h.quantity > 0
            ? h.avgBuyPrice * h.quantity
            : null;
        const pnl =
          cost != null && mv > 0 && Number.isFinite(mv) ? mv - cost : null;
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
          unrealizedPnlKrw:
            pnl != null && Number.isFinite(pnl) ? Math.round(pnl) : null,
          industry: null,
          subIndustry: null,
          sectorEn: null,
          sectorKo: null,
        };
      });
    }
    return [];
  }, [provider, activeToss, bithumbSnapshot, usdKrwRate, feeRates, enrichMap]);

  const cashNativeKrw = useMemo(() => {
    if (provider === "toss" && activeToss) {
      return Number(activeToss.cash.krw) || 0;
    }
    if (provider === "bithumb" && bithumbSnapshot) {
      return Number(bithumbSnapshot.krw?.total) || 0;
    }
    return 0;
  }, [provider, activeToss, bithumbSnapshot]);

  const cashNativeUsd = useMemo(() => {
    if (provider === "toss" && activeToss) {
      return Number(activeToss.cash.usd) || 0;
    }
    return 0;
  }, [provider, activeToss]);

  /** ??????? ? ?? ??? ??? ??? ?? */
  const cashKrw = useMemo(() => {
    if (provider === "toss" && activeToss) {
      const fx =
        usdKrwRate != null && Number.isFinite(usdKrwRate) && usdKrwRate > 0
          ? cashNativeUsd * usdKrwRate
          : 0;
      return cashNativeKrw + fx;
    }
    return cashNativeKrw;
  }, [provider, activeToss, cashNativeKrw, cashNativeUsd, usdKrwRate]);

  const labels = useMemo(
    () => ({
      cash: ko.app.accountManageCash,
      other: ko.app.accountManageOther,
      marketKr: ko.app.accountManageMarketKr,
      marketUs: ko.app.accountManageMarketUs,
      marketCrypto: ko.app.accountManageMarketCrypto,
      styleGrowth: ko.app.accountManageStyleGrowth,
      styleValue: ko.app.accountManageStyleValue,
    }),
    [],
  );

  const slices = useMemo(
    () =>
      buildAccountAllocationSlices(
        holdingRows,
        cashKrw,
        allocMode,
        labels,
        styleOverrides,
      ),
    [holdingRows, cashKrw, allocMode, labels, styleOverrides],
  );

  const { segments, total } = useMemo(
    () => accountSlicesToDonut(slices),
    [slices],
  );

  const styleSlices = useMemo(
    () =>
      buildAccountAllocationSlices(
        holdingRows,
        cashKrw,
        "style",
        labels,
        styleOverrides,
      ),
    [holdingRows, cashKrw, labels, styleOverrides],
  );

  const { segments: styleSegments } = useMemo(
    () => accountSlicesToDonut(styleSlices),
    [styleSlices],
  );

  const filteredRows = useMemo(() => {
    const key = styleFocusKey ?? focusKey;
    const source = styleFocusKey ? styleSlices : slices;
    if (!key) return holdingRows;
    if (key === "__cash__") return [];
    const slice = source.find((s) => s.key === key);
    if (!slice) return holdingRows;
    const set = new Set(slice.symbols.map((s) => s.toUpperCase()));
    return holdingRows.filter((r) => set.has(r.symbol.toUpperCase()));
  }, [focusKey, styleFocusKey, holdingRows, slices, styleSlices]);

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

  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (provider === "toss") await reloadToss?.(true);
      else await reloadBithumb?.(true);
    } finally {
      setRefreshing(false);
    }
  }, [provider, reloadToss, reloadBithumb, refreshing]);

  const onBuyNowFromToolbar = useCallback(async () => {
    if (buyingNow) return;
    if (!anySelectedMarketRegularOpen(["kr", "us"])) {
      window.alert(ko.app.accountManageRebalanceNowHoursBlocked);
      return;
    }
    if (!window.confirm(ko.app.accountManageRebalanceNowConfirm)) return;
    setBuyingNow(true);
    try {
      const res = await runTossRebalanceNow({ dryRun: false });
      if (!res.ok) {
        window.alert(res.error || ko.app.accountManageRebalanceNowHoursBlocked);
        return;
      }
      const placed = res.placed?.length ?? 0;
      const failed = res.errors?.length ?? 0;
      const skipped = res.skippedMarkets ?? [];
      const skipNote =
        skipped.length > 0
          ? `\n${ko.app.accountManageRebalanceNowSkipped.replace(
              "{markets}",
              skipped
                .map((m) =>
                  m === "us"
                    ? ko.app.accountManageMarketUs
                    : ko.app.accountManageMarketKr,
                )
                .join(", "),
            )}`
          : "";
      if (placed === 0 && failed === 0) {
        window.alert(`${ko.app.accountManageRebalanceNowNone}${skipNote}`);
      } else if (failed > 0) {
        const detail = res.errors?.[0]?.error
          ? ` ${res.errors[0].error}`
          : "";
        window.alert(
          `${ko.app.accountManageRebalanceNowFail
            .replace("{ok}", String(placed))
            .replace("{total}", String(placed + failed))}${detail}${skipNote}`,
        );
      } else {
        window.alert(
          `${ko.app.accountManageRebalanceNowOk.replace("{n}", String(placed))}${skipNote}`,
        );
      }
      await reloadToss?.(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBuyingNow(false);
    }
  }, [buyingNow, reloadToss]);

  const buyNowToolbarAllowed = anySelectedMarketRegularOpen(["kr", "us"]);

  const renderRebalanceActionButtons = (
    variant: "toolbar" | "wheel" | "bridge",
  ) => (
    <>
      <button
        type="button"
        className={[
          "bithumb-balance-hide-btn",
          "account-manage-tab__hide-btn",
          "account-manage-tab__hide-btn--summary",
          variant === "wheel" ? "account-manage-tab__hide-btn--wheel" : "",
          variant === "bridge" ? "account-manage-tab__hide-btn--bridge" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-vu={
          variant === "wheel"
            ? "account-rebalance-open-wheel"
            : variant === "bridge"
              ? "account-rebalance-open-bridge"
              : "account-rebalance-open"
        }
        title={ko.app.accountManageRebalanceMarketHint}
        onClick={() => setRebalanceOpen(true)}
      >
        {ko.app.accountManageRebalanceOpen}
      </button>
      <button
        type="button"
        className={[
          "bithumb-balance-hide-btn",
          "account-manage-tab__hide-btn",
          "account-manage-tab__hide-btn--summary",
          "account-manage-tab__hide-btn--accent",
          variant === "wheel" ? "account-manage-tab__hide-btn--wheel" : "",
          variant === "bridge" ? "account-manage-tab__hide-btn--bridge" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-vu={
          variant === "wheel"
            ? "account-rebalance-buy-now-wheel"
            : variant === "bridge"
              ? "account-rebalance-buy-now-bridge"
              : "account-rebalance-buy-now-toolbar"
        }
        disabled={buyingNow || !buyNowToolbarAllowed}
        title={
          buyNowToolbarAllowed
            ? ko.app.accountManageRebalanceNowConfirm.split("\n")[0]
            : ko.app.accountManageRebalanceNowHoursHint
        }
        onClick={() => void onBuyNowFromToolbar()}
      >
        {buyingNow
          ? ko.app.accountManageRebalanceNowRunning
          : ko.app.accountManageRebalanceNow}
      </button>
    </>
  );

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
    setStyleHoveredKey(null);
  }, []);

  const onStyleChipClick = useCallback(
    (key: string) => {
      setFocusKey(null);
      setStyleFocusKey((prev) => (prev === key ? null : key));
      hideHoverBubble();
    },
    [hideHoverBubble],
  );

  const hoverSlice = hoverBubble
    ? (styleSlices.find((s) => s.key === hoverBubble.key) ??
      slices.find((s) => s.key === hoverBubble.key) ??
      null)
    : null;
  const hoverSeg = hoverBubble
    ? (styleSegments.find((s) => s.sector === hoverBubble.key) ??
      segments.find((s) => s.sector === hoverBubble.key) ??
      null)
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
      <div
        className="account-manage-tab"
        aria-label={ko.app.accountManageAria}
        data-vu="account-manage-loading"
      >
        <DockPanelCenterLoading label={ko.app.accountManageLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="account-manage-tab"
        aria-label={ko.app.accountManageAria}
        data-vu="account-manage-guest"
      >
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
  const hasAccountData =
    provider === "toss" ? Boolean(tossSnapshot) : Boolean(bithumbSnapshot);
  const summaryPending = ready && loading && !hasAccountData;
  const updatedAtMs =
    provider === "toss"
      ? quotesUpdatedAtMs ?? tossUpdatedAtMs
      : bithumbUpdatedAtMs;

  const contentReady =
    ready &&
    !loading &&
    (provider !== "toss" || Boolean(tossSnapshot) || Boolean(bithumbSnapshot));

  return (
    <div
      className={[
        "account-manage-tab",
        balanceHidden ? "account-manage-tab--balance-hidden" : "",
        refreshing ? "account-manage-tab--refreshing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ko.app.accountManageAria}
      data-vu={contentReady ? "account-manage-ready" : "account-manage-shell"}
    >
      <header className="account-manage-tab__head">
        <div>
          <h2 className="account-manage-tab__title">{ko.app.accountManageTitle}</h2>
          <p className="account-manage-tab__sub">
            {ko.app.accountManageSubtitle}
            {user.email ? ` ${user.email}` : ""}
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
            className={[
              "btn btn--secondary account-manage-tab__refresh",
              refreshing ? "account-manage-tab__refresh--busy" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => void onRefresh()}
            disabled={loading || refreshing}
            aria-busy={refreshing || undefined}
          >
            {refreshing ? (
              <>
                <span
                  className="btn-inline-spinner"
                  aria-hidden
                />
                {ko.app.accountManageRefreshing}
              </>
            ) : (
              ko.app.accountManageRefresh
            )}
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
      ) : err && !hasAccountData ? (
        <p className="account-manage-tab__error" role="alert">
          {err}
        </p>
      ) : (
        <>
          <div
            className="account-manage-tab__summary-wrap"
            role="region"
            aria-label={ko.app.accountManageSummaryAria}
            aria-busy={summaryPending || undefined}
          >
            <div className="account-manage-tab__summary-toolbar">
              {refreshing ? (
                <span
                  className="account-manage-tab__refresh-indicator"
                  role="status"
                  aria-live="polite"
                  aria-label={ko.app.accountManageRefreshing}
                  title={ko.app.accountManageRefreshing}
                >
                  <span
                    className="account-manage-tab__refresh-spinner"
                    aria-hidden
                  />
                </span>
              ) : (
                <span className="account-manage-tab__toolbar-grow" aria-hidden />
              )}
              {provider === "toss" ? (
                <>
                  <div
                    className="account-manage-tab__rebalance-hours"
                    role="group"
                    aria-label={ko.app.accountManageRebalanceMarketHoursAria}
                  >
                    {(["kr", "us"] as const).map((m) => {
                      const hoursOpen = isMarketRegularOpenClient(m);
                      return (
                        <span
                          key={m}
                          className={[
                            "account-manage-tab__rebalance-hour-chip",
                            m === "us" ? "is-usd" : "is-krw",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "account-rebalance-modal__badge",
                              m === "us" ? "is-usd" : "is-krw",
                            ].join(" ")}
                          >
                            {m === "us" ? "$" : "원"}
                          </span>
                          <span className="account-manage-tab__rebalance-hour-name">
                            {m === "us"
                              ? ko.app.accountManageMarketUs
                              : ko.app.accountManageMarketKr}
                          </span>
                          <span className="account-manage-tab__rebalance-hour-cur">
                            {m === "us"
                              ? ko.app.accountManageCurrencyUsd
                              : ko.app.accountManageCurrencyKrw}
                          </span>
                          <span
                            className={[
                              "account-rebalance-modal__chip-hours",
                              hoursOpen ? "is-open" : "is-closed",
                            ].join(" ")}
                          >
                            {hoursOpen
                              ? ko.app.accountManageRebalanceMarketRegularOpen
                              : ko.app.accountManageRebalanceMarketRegularClosed}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  <div
                    className="account-manage-tab__toolbar-rebalance"
                    role="group"
                    aria-label={ko.app.accountManageRebalanceTitle}
                  >
                    {renderRebalanceActionButtons("toolbar")}
                  </div>
                </>
              ) : null}
              <div
                className="account-manage-tab__currency-toggle"
                role="group"
                aria-label={ko.app.accountManageCurrencyAria}
              >
                <button
                  type="button"
                  className={
                    displayCurrency === "KRW"
                      ? "account-manage-tab__currency-btn is-active"
                      : "account-manage-tab__currency-btn"
                  }
                  aria-pressed={displayCurrency === "KRW"}
                  onClick={() => setDisplayCurrency("KRW")}
                >
                  {ko.app.accountManageCurrencyKrw}
                </button>
                <button
                  type="button"
                  className={
                    displayCurrency === "USD"
                      ? "account-manage-tab__currency-btn is-active"
                      : "account-manage-tab__currency-btn"
                  }
                  aria-pressed={displayCurrency === "USD"}
                  disabled={!(usdKrwRate != null && usdKrwRate > 0)}
                  title={
                    usdKrwRate != null && usdKrwRate > 0
                      ? ko.app.accountManageCurrencyUsdRate.replace(
                          "{rate}",
                          Math.round(usdKrwRate).toLocaleString("ko-KR"),
                        )
                      : undefined
                  }
                  onClick={() => setDisplayCurrency("USD")}
                >
                  {ko.app.accountManageCurrencyUsd}
                </button>
              </div>
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
          <div className="account-manage-tab__summary-row">
            <div className="account-manage-tab__summary account-manage-tab__summary--primary">
              <div className="account-manage-tab__stat">
                <span className="account-manage-tab__stat-label">
                  {ko.app.accountManageTotal}
                </span>
                <span className="account-manage-tab__stat-value">
                  <span
                    className="account-manage-tab__money"
                    aria-hidden={balanceHidden || undefined}
                  >
                    {summaryPending
                      ? "…"
                      : money((holdingsTotalKrw ?? 0) + cashKrw)}
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
                    !summaryPending &&
                    holdingsReturnPct != null &&
                    holdingsReturnPct > 0
                      ? "is-up"
                      : !summaryPending &&
                          holdingsReturnPct != null &&
                          holdingsReturnPct < 0
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
                    {summaryPending ? "…" : money(holdingsTotalKrw)}
                  </span>
                  {!summaryPending && holdingsReturnPct != null ? (
                    <span className="account-manage-tab__stat-pct">
                      {" "}
                      ({formatPercent(holdingsReturnPct)})
                    </span>
                  ) : null}
                </span>
              </div>
              {provider === "toss" ? (
                <>
                  <div
                    className="account-manage-tab__stat account-manage-tab__stat--cash account-manage-tab__stat--cash-krw"
                    role="group"
                    aria-label={accountCashStatAria(
                      ko.app.accountManageCashKrw,
                      formatPrice(cashNativeKrw, "KRW"),
                      balanceHidden,
                      summaryPending,
                    )}
                    data-vu="account-summary-cash-krw"
                  >
                    <span className="account-manage-tab__stat-label" aria-hidden="true">
                      <span className="account-rebalance-modal__badge is-krw" aria-hidden="true">
                        원
                      </span>
                      {ko.app.accountManageCashKrw}
                    </span>
                    <span className="account-manage-tab__stat-value" aria-hidden="true">
                      <span className="account-manage-tab__money">
                        {summaryPending
                          ? "…"
                          : formatPrice(cashNativeKrw, "KRW")}
                      </span>
                    </span>
                  </div>
                  <div
                    className="account-manage-tab__stat account-manage-tab__stat--cash account-manage-tab__stat--cash-usd"
                    role="group"
                    aria-label={accountCashStatAria(
                      ko.app.accountManageCashUsd,
                      formatPrice(cashNativeUsd, "USD"),
                      balanceHidden,
                      summaryPending,
                      !summaryPending &&
                        cashNativeUsd > 0 &&
                        usdKrwRate != null &&
                        usdKrwRate > 0
                        ? ko.app.accountManageCashUsdKrwHint.replace(
                            "{amount}",
                            formatPrice(
                              Math.round(cashNativeUsd * usdKrwRate),
                              "KRW",
                            ),
                          )
                        : undefined,
                    )}
                    data-vu="account-summary-cash-usd"
                  >
                    <span className="account-manage-tab__stat-label" aria-hidden="true">
                      <span className="account-rebalance-modal__badge is-usd" aria-hidden="true">
                        $
                      </span>
                      {ko.app.accountManageCashUsd}
                    </span>
                    <span className="account-manage-tab__stat-value" aria-hidden="true">
                      <span className="account-manage-tab__money">
                        {summaryPending
                          ? "…"
                          : formatPrice(cashNativeUsd, "USD")}
                      </span>
                      {!summaryPending &&
                      cashNativeUsd > 0 &&
                      usdKrwRate != null &&
                      usdKrwRate > 0 ? (
                        <span className="account-manage-tab__stat-sub">
                          {formatPrice(
                            Math.round(cashNativeUsd * usdKrwRate),
                            "KRW",
                          )}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </>
              ) : (
                <div className="account-manage-tab__stat">
                  <span className="account-manage-tab__stat-label">
                    {ko.app.accountManageCash}
                  </span>
                  <span className="account-manage-tab__stat-value">
                    <span
                      className="account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {summaryPending ? "…" : money(cashKrw)}
                    </span>
                  </span>
                </div>
              )}
            </div>
            {netSummary?.profitLossKrw != null || updatedAtMs || refreshing ? (
              <details className="account-manage-tab__summary-more">
                <summary>{ko.app.accountManageSummaryMore}</summary>
                <div className="account-manage-tab__summary account-manage-tab__summary--secondary">
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
                          {signedMoney(netSummary.profitLossKrw)}
                          {netSummary.totalReturnPct != null
                            ? ` (${formatPercent(netSummary.totalReturnPct)})`
                            : ""}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {updatedAtMs || refreshing ? (
                    <div className="account-manage-tab__stat account-manage-tab__stat--muted">
                      <span className="account-manage-tab__stat-label">
                        {ko.app.accountManageUpdated}
                        {refreshing ? (
                          <span
                            className="account-manage-tab__refresh-spinner account-manage-tab__refresh-spinner--inline"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                      <span className="account-manage-tab__stat-value">
                        {updatedAtMs
                          ? new Date(updatedAtMs).toLocaleTimeString("ko-KR", {
                              timeZone: "Asia/Seoul",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              hour12: false,
                            })
                          : "?"}
                      </span>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
            {provider === "toss" ? (
              <div
                className="account-manage-tab__summary-toolbar account-manage-tab__summary-toolbar--rebalance"
                role="group"
                aria-label={ko.app.accountManageRebalanceTitle}
              >
                <span className="account-manage-tab__rebalance-bridge-label">
                  {ko.app.accountManageRebalanceTitle}
                </span>
                <div className="account-manage-tab__rebalance-bridge-actions">
                  {renderRebalanceActionButtons("bridge")}
                </div>
              </div>
            ) : null}
          </div>

          {summaryPending ? (
            <DockPanelCenterLoading label={ko.app.accountManageLoading} />
          ) : err ? (
            <p className="account-manage-tab__error" role="alert">
              {err}
            </p>
          ) : (
            <>
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
                    {ko.app.accountManageChartBasis}{" "}
                    <span
                      className="account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {money(total)}
                    </span>
                  </p>
                </div>
                {provider === "toss" ? (
                  <div
                    className="account-manage-tab__wheel-rebalance"
                    role="group"
                    aria-label={ko.app.accountManageRebalanceTitle}
                  >
                    <span className="account-manage-tab__wheel-rebalance-label">
                      {ko.app.accountManageRebalanceTitle}
                    </span>
                    <div className="account-manage-tab__wheel-rebalance-actions">
                      {renderRebalanceActionButtons("wheel")}
                    </div>
                  </div>
                ) : null}
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
                      setStyleFocusKey(null);
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

              {styleSegments.length > 0 ? (
                <div
                  className="account-manage-tab__style-strip"
                  role="group"
                  aria-label={ko.app.accountManageStyleChartTitle}
                >
                  {styleSegments.map((seg) => {
                    const active = styleFocusKey === seg.sector;
                    return (
                      <button
                        key={`style-chip-${seg.sector}`}
                        type="button"
                        className={[
                          "account-manage-tab__style-chip",
                          active ? "active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-pressed={active}
                        onClick={() => onStyleChipClick(seg.sector)}
                      >
                        <span
                          className="account-manage-tab__swatch"
                          style={{ background: seg.color }}
                          aria-hidden
                        />
                        <span className="account-manage-tab__style-chip-label">
                          {seg.sectorKo}
                        </span>
                        <span className="account-manage-tab__style-chip-pct">
                          {formatAllocPct(seg.pct)}
                        </span>
                      </button>
                    );
                  })}
                  <p className="account-manage-tab__style-strip-hint">
                    {ko.app.accountManageStyleStripHint}
                  </p>
                </div>
              ) : null}

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
                            onClick={() => {
                              setStyleFocusKey(null);
                              setFocusKey((prev) =>
                                prev === seg.sector ? null : seg.sector,
                              );
                            }}
                            onMouseEnter={(e) => {
                              setHoveredKey(seg.sector);
                              setStyleHoveredKey(null);
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
                            onClick={() => {
                              setStyleFocusKey(null);
                              setFocusKey((prev) =>
                                prev === seg.sector ? null : seg.sector,
                              );
                            }}
                            onMouseEnter={(e) => {
                              setHoveredKey(seg.sector);
                              setStyleHoveredKey(null);
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
                              {money(slice?.valueKrw)}
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
                          setStyleHoveredKey(null);
                          showHoverBubble(seg.sector, e.clientX, e.clientY);
                        }}
                        onMouseMove={(e) => {
                          showHoverBubble(seg.sector, e.clientX, e.clientY);
                        }}
                        onMouseLeave={hideHoverBubble}
                        onClick={() => {
                          setStyleFocusKey(null);
                          setFocusKey((prev) =>
                            prev === seg.sector ? null : seg.sector,
                          );
                        }}
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
                          {money(slice?.valueKrw)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {panelTab === "chart" && styleSegments.length > 0 ? (
                <div className="account-manage-tab__style-block">
                  <div className="account-manage-tab__style-head">
                    <h4 className="account-manage-tab__style-title">
                      {ko.app.accountManageStyleChartTitle}
                    </h4>
                    <p className="account-manage-tab__wheel-sub">
                      {ko.app.accountManageStyleChartSub}
                    </p>
                    {stylePolicyLines.length > 0 ? (
                      <details className="account-manage-tab__style-policy">
                        <summary>
                          {ko.app.accountManageStylePolicyTitle}
                        </summary>
                        <ol>
                          {stylePolicyLines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ol>
                        <p>{ko.app.accountManageStylePolicyHint}</p>
                      </details>
                    ) : null}
                  </div>
                  <div className="account-manage-tab__chart-panel">
                    <svg
                      className="account-manage-tab__svg"
                      viewBox="0 0 200 200"
                      role="img"
                      aria-label={ko.app.accountManageStyleChartTitle}
                    >
                      {[...styleSegments]
                        .sort((a, b) => {
                          const aLift =
                            styleHoveredKey === a.sector ||
                            styleFocusKey === a.sector
                              ? 1
                              : 0;
                          const bLift =
                            styleHoveredKey === b.sector ||
                            styleFocusKey === b.sector
                              ? 1
                              : 0;
                          return aLift - bLift;
                        })
                        .map((seg) => {
                          const lifted =
                            styleHoveredKey === seg.sector ||
                            styleFocusKey === seg.sector;
                          const dimmed =
                            styleFocusKey && styleFocusKey !== seg.sector;
                          return (
                            <path
                              key={`style-${seg.sector}`}
                              className={[
                                "account-manage-tab__seg",
                                lifted ? "account-manage-tab__seg--lifted" : "",
                                dimmed ? "account-manage-tab__seg--dim" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              d={
                                lifted
                                  ? donutArcPathPopOut(
                                      cx,
                                      cy,
                                      r0,
                                      r1,
                                      seg.a0,
                                      seg.a1,
                                    )
                                  : donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)
                              }
                              fill={seg.color}
                              onClick={() => onStyleChipClick(seg.sector)}
                              onMouseEnter={(e) => {
                                setStyleHoveredKey(seg.sector);
                                setHoveredKey(null);
                                showHoverBubble(
                                  seg.sector,
                                  e.clientX,
                                  e.clientY,
                                );
                              }}
                              onMouseMove={(e) => {
                                showHoverBubble(
                                  seg.sector,
                                  e.clientX,
                                  e.clientY,
                                );
                              }}
                              onMouseLeave={hideHoverBubble}
                            />
                          );
                        })}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r0 - 2}
                        className="account-manage-tab__hole"
                      />
                      <text
                        x={cx}
                        y={cy - 4}
                        textAnchor="middle"
                        className="account-manage-tab__center-label"
                      >
                        {styleFocusKey
                          ? (styleSegments.find((s) => s.sector === styleFocusKey)
                              ?.sectorKo ?? "")
                          : ko.app.accountManageGroupStyle}
                      </text>
                      <text
                        x={cx}
                        y={cy + 14}
                        textAnchor="middle"
                        className="account-manage-tab__center-pct"
                      >
                        {styleFocusKey
                          ? formatAllocPct(
                              styleSegments.find((s) => s.sector === styleFocusKey)
                                ?.pct ?? 0,
                            )
                          : formatAllocPct(100)}
                      </text>
                    </svg>
                    <ul className="account-manage-tab__legend">
                      {styleSegments.map((seg) => {
                        const slice = styleSlices.find(
                          (s) => s.key === seg.sector,
                        );
                        return (
                          <li key={`style-leg-${seg.sector}`}>
                            <button
                              type="button"
                              className={[
                                "account-manage-tab__legend-btn",
                                styleFocusKey === seg.sector ? "active" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => onStyleChipClick(seg.sector)}
                              onMouseEnter={(e) => {
                                setStyleHoveredKey(seg.sector);
                                setHoveredKey(null);
                                showHoverBubble(
                                  seg.sector,
                                  e.clientX,
                                  e.clientY,
                                );
                              }}
                              onMouseMove={(e) => {
                                showHoverBubble(
                                  seg.sector,
                                  e.clientX,
                                  e.clientY,
                                );
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
                                {money(slice?.valueKrw)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              ) : panelTab === "list" && styleSegments.length > 0 ? (
                <ul className="account-manage-tab__style-list">
                  {styleSegments.map((seg) => {
                    const slice = styleSlices.find((s) => s.key === seg.sector);
                    return (
                      <li key={`style-list-${seg.sector}`}>
                        <button
                          type="button"
                          className={[
                            "account-manage-tab__style-list-btn",
                            styleFocusKey === seg.sector ? "active" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => onStyleChipClick(seg.sector)}
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
                            {money(slice?.valueKrw)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

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
                      {money(hoverSlice.valueKrw)}
                    </span>
                  </div>
                  <div className="account-manage-tab__bubble-row">
                    <span>{ko.app.accountManageColWeight}</span>
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
                              {money(r.valueKrw)}
                            </span>
                          </li>
                        ))}
                        {hoverSlice.symbols.length > hoverRows.length ? (
                          <li className="account-manage-tab__bubble-more">
                            {ko.app.accountManageBubbleMore.replace(
                              "{n}",
                              String(hoverSlice.symbols.length - hoverRows.length),
                            )}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {focusKey || styleFocusKey ? (
                <div className="account-manage-tab__filter-bar">
                  <span className="account-manage-tab__filter-label">
                    {styleFocusKey
                      ? ko.app.accountManageStyleFilterActive.replace(
                          "{label}",
                          styleSegments.find((s) => s.sector === styleFocusKey)
                            ?.sectorKo ?? "",
                        )
                      : ko.app.accountManageWeightFilterActive.replace(
                          "{label}",
                          segments.find((s) => s.sector === focusKey)?.sectorKo ??
                            "",
                        )}
                  </span>
                  <button
                    type="button"
                    className="account-manage-tab__clear"
                    onClick={() => {
                      setFocusKey(null);
                      setStyleFocusKey(null);
                    }}
                  >
                    {ko.app.accountManageClearFilter}
                  </button>
                </div>
              ) : (
                <p className="account-manage-tab__hint">
                  {ko.app.accountManagePickHint} {ko.app.accountManageHoverHint}
                </p>
              )}
            </aside>

            <section className="account-manage-tab__holdings card">
              <h3 className="account-manage-tab__holdings-title">
                {styleFocusKey
                  ? styleSegments.find((s) => s.sector === styleFocusKey)
                      ?.sectorKo ?? ko.app.accountManageTabList
                  : focusKey
                    ? segments.find((s) => s.sector === focusKey)?.sectorKo ??
                      ko.app.accountManageTabList
                    : ko.app.accountManageTabList}
              </h3>
              {filteredRows.length === 0 ? (
                <p className="account-manage-tab__empty">
                  {focusKey === "__cash__" || styleFocusKey === "__cash__" ? (
                    provider === "toss" ? (
                      <span
                        className="account-manage-tab__cash-split"
                        aria-hidden={balanceHidden || undefined}
                      >
                        <span>
                          {ko.app.accountManageCashKrw}{" "}
                          <span className="account-manage-tab__money">
                            {formatPrice(cashNativeKrw, "KRW")}
                          </span>
                        </span>
                        <span>
                          {ko.app.accountManageCashUsd}{" "}
                          <span className="account-manage-tab__money">
                            {formatPrice(cashNativeUsd, "USD")}
                          </span>
                        </span>
                      </span>
                    ) : (
                      <span
                        className="account-manage-tab__money"
                        aria-hidden={balanceHidden || undefined}
                      >
                        {money(cashKrw)}
                      </span>
                    )
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
                        <th>{ko.app.accountManageStyleCol}</th>
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
                        <th>{ko.app.accountManageColWeight}</th>
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
                        const ticker = normalizeAccountStyleTicker(row.symbol);
                        const overrideStyle = styleOverrides[ticker];
                        const resolved = resolveAccountHoldingStyle(
                          row,
                          styleOverrides,
                        );
                        const selectVal = overrideStyle ?? "auto";
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
                              <label className="account-manage-tab__style-select-wrap">
                                <select
                                  className="account-manage-tab__style-select"
                                  aria-label={ko.app.accountManageStyleCol}
                                  value={selectVal}
                                  disabled={styleSavingSym === row.symbol}
                                  title={
                                    overrideStyle
                                      ? ko.app.accountManageStylePolicyHint
                                      : ko.app.accountManageStyleAutoOption.replace(
                                          "{style}",
                                          resolved.style === "growth"
                                            ? ko.app.accountManageStyleGrowth
                                            : ko.app.accountManageStyleValue,
                                        )
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    void onSetHoldingStyle(
                                      row.symbol,
                                      v === "auto"
                                        ? "auto"
                                        : (v as AccountHoldingStyle),
                                    );
                                  }}
                                >
                                  <option value="auto">
                                    {ko.app.accountManageStyleAutoOption.replace(
                                      "{style}",
                                      resolved.style === "growth"
                                        ? ko.app.accountManageStyleGrowth
                                        : ko.app.accountManageStyleValue,
                                    )}
                                  </option>
                                  <option value="growth">
                                    {ko.app.accountManageStyleGrowth}
                                  </option>
                                  <option value="value">
                                    {ko.app.accountManageStyleValue}
                                  </option>
                                </select>
                              </label>
                            </td>
                            <td>
                              {allocMode === "symbol"
                                ? row.market === "us"
                                  ? labels.marketUs
                                  : row.market === "crypto"
                                    ? labels.marketCrypto
                                    : labels.marketKr
                                : allocMode === "subIndustry"
                                  ? row.subIndustry || row.industry || row.sectorKo || "?"
                                  : row.sectorKo || row.industry || "?"}
                            </td>
                            <td>{row.quantity}</td>
                            <td>
                              <span
                                className="account-manage-tab__money"
                                aria-hidden={balanceHidden || undefined}
                              >
                                {money(row.valueKrw)}
                              </span>
                            </td>
                            <td
                              className={
                                row.returnPercent != null && row.returnPercent > 0
                                  ? "is-up"
                                  : row.returnPercent != null && row.returnPercent < 0
                                    ? "is-down"
                                    : row.unrealizedPnlKrw != null &&
                                        row.unrealizedPnlKrw > 0
                                      ? "is-up"
                                      : row.unrealizedPnlKrw != null &&
                                          row.unrealizedPnlKrw < 0
                                        ? "is-down"
                                        : ""
                              }
                            >
                              {row.returnPercent != null ||
                              row.unrealizedPnlKrw != null ? (
                                <span className="account-manage-tab__return-cell">
                                  {row.unrealizedPnlKrw != null ? (
                                    <span
                                      className="account-manage-tab__money"
                                      aria-hidden={balanceHidden || undefined}
                                    >
                                      {signedMoney(row.unrealizedPnlKrw)}
                                    </span>
                                  ) : null}
                                  {row.returnPercent != null ? (
                                    <span className="account-manage-tab__return-pct">
                                      {row.unrealizedPnlKrw != null ? " " : null}
                                      ({formatPercent(row.returnPercent)})
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                "?"
                              )}
                            </td>
                            <td className="account-manage-tab__weight">
                              {total > 0 && row.valueKrw > 0
                                ? formatAllocPct((row.valueKrw / total) * 100)
                                : "?"}
                            </td>
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
            <summary>{ko.app.accountManageRawSummary}</summary>
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
        </>
      )}

      {rebalanceOpen ? (
        <AccountRebalanceScheduleModal
          onClose={() => setRebalanceOpen(false)}
          onOrdersPlaced={() => void reloadToss?.(true)}
        />
      ) : null}
    </div>
  );
}
