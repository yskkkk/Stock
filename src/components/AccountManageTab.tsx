import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAccountHoldingStyle,
  fetchSp500Sectors,
  fetchTossHoldingsManage,
  fetchTossRebalanceSchedule,
  putAccountHoldingStyleOverride,
  runTossRebalanceNow,
  type TossRebalanceBuyPlan,
  type TossTestHolding,
} from "../api";
import { ko } from "../i18n/ko";
import {
  accountSlicesToDonut,
  accountSymbolSliceLabel,
  buildAccountAllocationSlices,
  computeStyleTargetDrift,
  portfolioShareChangePct,
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
  fmtSectorPct,
} from "../lib/sp500SectorChart";
import {
  mergeTossFeeRates,
  tossFeeRatesFromLegacy,
} from "../lib/tossHoldingFeeRates";
import {
  computeTossAccountCombinedPnl,
  computeTossHoldingsDisplayPnl,
  tossHoldingsTotalNetMarketValueKrw,
} from "../lib/tossHoldingPnl";
import { formatPercent, formatPrice, formatSignedMoney, formatTimeMsKst, formatUpdatedAt } from "../lib/format";
import {
  buildRebalanceNowConfirmMessage,
  buildRebalanceNowRunSubLabel,
  buildRebalancePreviewSubLabel,
  buildRebalanceRunSummaryLead,
  buildRebalanceSpendSummaryInline,
  buildRebalanceSpendSummaryLead,
  withRebalanceAmountNote,
} from "../lib/rebalancePlanSummary";
import { anySelectedMarketRegularOpen, isMarketRegularOpenClient } from "../lib/marketRegularHours";
import { resolveSymbolDisplayName } from "../lib/symbolDisplayName";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import { useAccountHiddenHoldings } from "../hooks/useAccountHiddenHoldings";
import {
  useAccountManageDisplayCurrency,
  type AccountManageDisplayCurrency,
} from "../hooks/useAccountManageDisplayCurrency";
import { useAccountStyleTargetWeights } from "../hooks/useAccountStyleTargetWeights";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import {
  TOSS_LEDGER_POLL_MS,
  useTossAccountSnapshot,
} from "../hooks/useTossAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import { useTossSnapshotLiveQuotes } from "../hooks/useTossSnapshotLiveQuotes";
import { tossSnapshotLedgerFingerprint, tossSnapshotSymbolKey } from "../lib/tossSnapshotLiveQuotes";
import LiveTradeAuthPanel, {
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";
import LiveTradeApiNotConnectedNotice from "./LiveTradeApiNotConnectedNotice";
import TossAccountSnapshotCard from "./TossAccountSnapshotCard";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import AccountRebalanceScheduleModal from "./AccountRebalanceScheduleModal";
import RebalanceSpendSummaryList from "./RebalanceSpendSummaryList";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import AccountCurrencySlideToggle from "./AccountCurrencySlideToggle";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import { syncTossPurchaseFxLedger } from "../lib/tossPurchaseFxLedger";
import "./account-manage-tab.css";
import "./account-rebalance-schedule-modal.css";

type PanelTab = "chart" | "list";

function krwToDisplay(
  n: number | null | undefined,
  currency: AccountManageDisplayCurrency,
  usdKrwRate: number | null,
): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (currency === "KRW") return Math.round(n);
  if (!(usdKrwRate != null && Number.isFinite(usdKrwRate) && usdKrwRate > 0)) {
    return null;
  }
  return Math.round((n / usdKrwRate) * 100) / 100;
}

/** `unrealizedPnlKrw` is display-currency units; convert to KRW to pair with `valueKrw`. */
function displayPnlToKrw(
  pnlDisplay: number | null | undefined,
  currency: AccountManageDisplayCurrency,
  usdKrwRate: number | null,
): number | null {
  if (pnlDisplay == null || !Number.isFinite(pnlDisplay)) return null;
  if (currency === "KRW") return pnlDisplay;
  if (!(usdKrwRate != null && Number.isFinite(usdKrwRate) && usdKrwRate > 0)) {
    return null;
  }
  return pnlDisplay * usdKrwRate;
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

function formatDriftPctPoints(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const abs = Math.abs(n);
  const body = abs > 0 && abs < 0.1 ? abs.toFixed(2) : abs.toFixed(1);
  if (n > 0) return `+${body}%p`;
  if (n < 0) return `-${body}%p`;
  return `0%p`;
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

  useEffect(() => {
    if (tossReady) setProvider("toss");
    else if (bithumbReady) setProvider("bithumb");
  }, [tossReady, bithumbReady]);
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
  const [styleColHighlight, setStyleColHighlight] = useState(false);
  const [hiddenHoldingsOpen, setHiddenHoldingsOpen] = useState(true);
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
  const holdingsRef = useRef<HTMLElement | null>(null);
  const [balanceHidden, toggleBalanceHidden] = useBithumbBalanceHidden();
  const [displayCurrency, setDisplayCurrency] = useAccountManageDisplayCurrency(
    user?.id,
  );
  const [styleTargetParts, setStyleTargetParts, setStyleGrowthParts] =
    useAccountStyleTargetWeights(user?.id, provider);
  const { hiddenTickers, isHidden, toggleHidden, clearHidden } =
    useAccountHiddenHoldings(user?.id);
  const [rebalanceOpen, setRebalanceOpen] = useState(false);
  const [rebalancePreviewPlans, setRebalancePreviewPlans] = useState<
    TossRebalanceBuyPlan[]
  >([]);
  const [rebalancePreviewMarkets, setRebalancePreviewMarkets] = useState<
    Array<"kr" | "us">
  >(["kr", "us"]);
  const [rebalanceScheduleEnabled, setRebalanceScheduleEnabled] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [slowFetch, setSlowFetch] = useState(false);
  const [, setHoursTick] = useState(0);
  const [freshnessTick, setFreshnessTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setHoursTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setFreshnessTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const loadRebalancePreview = useCallback(async () => {
    if (!user || !tossReady) {
      setRebalancePreviewPlans([]);
      return;
    }
    try {
      const res = await fetchTossRebalanceSchedule();
      const markets = (
        res.schedule?.markets?.length ? res.schedule.markets : ["kr", "us"]
      ).filter((m): m is "kr" | "us" => m === "kr" || m === "us");
      setRebalanceScheduleEnabled(Boolean(res.schedule?.enabled));
      setRebalancePreviewMarkets(markets.length ? markets : ["kr", "us"]);
      setRebalancePreviewPlans(res.preview?.plans ?? []);
    } catch {
      setRebalancePreviewPlans([]);
      setRebalanceScheduleEnabled(false);
    }
  }, [user, tossReady]);

  useEffect(() => {
    void loadRebalancePreview();
  }, [loadRebalancePreview]);

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
    syncing: tossSyncing,
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
    syncing: bithumbSyncing,
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
  const tossHoldingsSymKey = useMemo(
    () => tossSnapshotSymbolKey(activeToss),
    [activeToss],
  );
  const tossLedgerFp = useMemo(
    () => (activeToss ? tossSnapshotLedgerFingerprint(activeToss) : ""),
    [activeToss],
  );
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
    if (!user || provider !== "toss" || !tossHoldingsSymKey) return;
    const holdings = activeToss?.holdings ?? [];
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
            // 업종: Yahoo/Naver 우선, 없으면 S&P subIndustry
            subIndustry: industry || g?.subIndustry || null,
            sectorEn: g?.sector ?? null,
            sectorKo: g?.sectorKo ?? industry ?? null,
          });
        }
        for (const h of holdings) {
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
    // activeToss.holdings 전체 참조 금지 — 라이브 시세 갱신마다 SP500/관리 API 재호출됨
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tossHoldingsSymKey
  }, [user, provider, tossHoldingsSymKey]);

  const purchaseFxBySymbol = useMemo(() => {
    if (provider !== "toss" || !activeToss?.holdings?.length) {
      return new Map<string, number>();
    }
    return syncTossPurchaseFxLedger(
      user?.id,
      activeToss.holdings,
      usdKrwRate,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tossLedgerFp
  }, [provider, tossLedgerFp, user?.id, usdKrwRate]);

  const holdingRows: AccountHoldingRow[] = useMemo(() => {
    if (provider === "toss" && activeToss) {
      return tossHoldingsToAccountRows(
        activeToss.holdings,
        usdKrwRate,
        feeRates,
        enrichMap,
        purchaseFxBySymbol,
        displayCurrency,
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
          costBasisKrw:
            cost != null && Number.isFinite(cost) ? Math.round(cost) : null,
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
  }, [
    provider,
    activeToss,
    bithumbSnapshot,
    usdKrwRate,
    feeRates,
    enrichMap,
    purchaseFxBySymbol,
    displayCurrency,
  ]);

  const visibleHoldingRows = useMemo(
    () => holdingRows.filter((r) => !isHidden(r.symbol)),
    [holdingRows, isHidden],
  );

  const visibleTossHoldings = useMemo(() => {
    if (provider !== "toss" || !activeToss) return [];
    if (hiddenTickers.size === 0) return activeToss.holdings;
    return activeToss.holdings.filter((h) => !isHidden(h.symbol));
  }, [provider, activeToss, hiddenTickers, isHidden]);

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
        visibleHoldingRows,
        cashKrw,
        allocMode,
        labels,
        styleOverrides,
      ),
    [visibleHoldingRows, cashKrw, allocMode, labels, styleOverrides],
  );

  const { segments, total } = useMemo(
    () => accountSlicesToDonut(slices),
    [slices],
  );

  const cashKrwWeightPct = useMemo(() => {
    if (!(total > 0) || !(cashNativeKrw > 0)) return null;
    return (cashNativeKrw / total) * 100;
  }, [total, cashNativeKrw]);

  const cashUsdWeightPct = useMemo(() => {
    if (!(total > 0) || !(cashNativeUsd > 0)) return null;
    if (!(usdKrwRate != null && usdKrwRate > 0)) return null;
    return ((cashNativeUsd * usdKrwRate) / total) * 100;
  }, [total, cashNativeUsd, usdKrwRate]);

  const cashTotalWeightPct = useMemo(() => {
    if (!(total > 0) || !(cashKrw > 0)) return null;
    return (cashKrw / total) * 100;
  }, [total, cashKrw]);

  const totalCostKrw = useMemo(() => {
    let sum = cashKrw;
    for (const r of visibleHoldingRows) {
      const c =
        r.costBasisKrw != null && Number.isFinite(r.costBasisKrw) && r.costBasisKrw > 0
          ? r.costBasisKrw
          : r.valueKrw;
      if (Number.isFinite(c) && c > 0) sum += c;
    }
    return sum;
  }, [visibleHoldingRows, cashKrw]);

  const sliceShareChangePct = useCallback(
    (slice: { key: string; symbols: string[]; valueKrw: number } | undefined) => {
      if (!slice || !(total > 0) || !(totalCostKrw > 0)) return null;
      let sliceCost = 0;
      if (slice.key === "__cash__") {
        sliceCost = cashKrw;
      } else {
        const set = new Set(slice.symbols.map((s) => s.toUpperCase()));
        let any = false;
        for (const r of visibleHoldingRows) {
          if (!set.has(r.symbol.toUpperCase())) continue;
          const c =
            r.costBasisKrw != null &&
            Number.isFinite(r.costBasisKrw) &&
            r.costBasisKrw > 0
              ? r.costBasisKrw
              : r.valueKrw;
          if (!(Number.isFinite(c) && c > 0)) continue;
          sliceCost += c;
          any = true;
        }
        if (!any) return null;
      }
      return portfolioShareChangePct(
        slice.valueKrw,
        sliceCost,
        total,
        totalCostKrw,
      );
    },
    [visibleHoldingRows, cashKrw, total, totalCostKrw],
  );

  const styleSlices = useMemo(
    () =>
      buildAccountAllocationSlices(
        visibleHoldingRows,
        cashKrw,
        "style",
        labels,
        styleOverrides,
      ),
    [visibleHoldingRows, cashKrw, labels, styleOverrides],
  );

  const { segments: styleSegments } = useMemo(
    () => accountSlicesToDonut(styleSlices),
    [styleSlices],
  );

  const styleTargetDrift = useMemo(
    () => computeStyleTargetDrift(styleSlices, styleTargetParts),
    [styleSlices, styleTargetParts],
  );

  const styleSourceCounts = useMemo(() => {
    const counts: Record<
      string,
      { auto: number; specified: number }
    > = {
      __growth__: { auto: 0, specified: 0 },
      __value__: { auto: 0, specified: 0 },
    };
    for (const row of visibleHoldingRows) {
      const ticker = normalizeAccountStyleTicker(row.symbol);
      const overrideStyle = styleOverrides[ticker];
      const resolved = resolveAccountHoldingStyle(row, styleOverrides);
      const key = resolved.style === "growth" ? "__growth__" : "__value__";
      if (overrideStyle) counts[key].specified += 1;
      else counts[key].auto += 1;
    }
    return counts;
  }, [visibleHoldingRows, styleOverrides]);

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

  const listVisibleRows = useMemo(
    () => filteredRows.filter((r) => !isHidden(r.symbol)),
    [filteredRows, isHidden],
  );

  const hiddenHoldingRows = useMemo(
    () =>
      holdingRows
        .filter((r) => isHidden(r.symbol))
        .sort((a, b) => b.valueKrw - a.valueKrw),
    [holdingRows, isHidden],
  );

  const netSummary = useMemo(() => {
    if (provider !== "toss" || !activeToss) return null;
    return computeTossAccountCombinedPnl(
      visibleTossHoldings,
      hiddenTickers.size > 0 ? null : activeToss.summary,
      usdKrwRate,
      feeRates,
      purchaseFxBySymbol,
    );
  }, [
    provider,
    activeToss,
    visibleTossHoldings,
    hiddenTickers.size,
    usdKrwRate,
    feeRates,
    purchaseFxBySymbol,
  ]);

  const holdingsTotalKrw = useMemo(() => {
    if (provider === "toss" && activeToss) {
      return tossHoldingsTotalNetMarketValueKrw(
        visibleTossHoldings,
        hiddenTickers.size > 0 ? null : activeToss.summary,
        usdKrwRate,
        feeRates,
      );
    }
    return visibleHoldingRows.reduce((s, r) => s + r.valueKrw, 0);
  }, [
    provider,
    activeToss,
    visibleTossHoldings,
    hiddenTickers.size,
    usdKrwRate,
    feeRates,
    visibleHoldingRows,
  ]);

  const holdingsReturnPct = useMemo(() => {
    if (provider === "toss" && activeToss) {
      const d = computeTossHoldingsDisplayPnl(
        visibleTossHoldings,
        usdKrwRate,
        feeRates,
        purchaseFxBySymbol,
        displayCurrency,
      );
      if (d.returnPct != null && Number.isFinite(d.returnPct)) return d.returnPct;
    }
    if (
      hiddenTickers.size === 0 &&
      netSummary?.totalReturnPct != null &&
      Number.isFinite(netSummary.totalReturnPct)
    ) {
      return netSummary.totalReturnPct;
    }
    let weighted = 0;
    let weightSum = 0;
    for (const r of visibleHoldingRows) {
      if (r.returnPercent == null || !Number.isFinite(r.returnPercent)) continue;
      const w = r.valueKrw > 0 ? r.valueKrw : 0;
      if (w <= 0) continue;
      weighted += r.returnPercent * w;
      weightSum += w;
    }
    if (weightSum <= 0) return null;
    return weighted / weightSum;
  }, [
    provider,
    activeToss,
    visibleTossHoldings,
    usdKrwRate,
    feeRates,
    purchaseFxBySymbol,
    displayCurrency,
    netSummary,
    visibleHoldingRows,
    hiddenTickers.size,
  ]);

  /** 표시 통화 단위 손익(원 모드=원, $ 모드=$) — signedMoney 환산 금지 */
  const holdingsPnlDisplay = useMemo(() => {
    if (provider === "toss" && activeToss) {
      const d = computeTossHoldingsDisplayPnl(
        visibleTossHoldings,
        usdKrwRate,
        feeRates,
        purchaseFxBySymbol,
        displayCurrency,
      );
      if (d.pnl != null && Number.isFinite(d.pnl)) {
        return displayCurrency === "KRW" ? Math.round(d.pnl) : d.pnl;
      }
    }
    if (
      hiddenTickers.size === 0 &&
      netSummary?.profitLossKrw != null &&
      Number.isFinite(netSummary.profitLossKrw)
    ) {
      if (displayCurrency === "KRW") return Math.round(netSummary.profitLossKrw);
      if (usdKrwRate != null && usdKrwRate > 0) {
        return netSummary.profitLossKrw / usdKrwRate;
      }
    }
    let sum = 0;
    let any = false;
    for (const r of visibleHoldingRows) {
      if (r.unrealizedPnlKrw == null || !Number.isFinite(r.unrealizedPnlKrw)) continue;
      sum += r.unrealizedPnlKrw;
      any = true;
    }
    return any ? (displayCurrency === "KRW" ? Math.round(sum) : sum) : null;
  }, [
    provider,
    activeToss,
    visibleTossHoldings,
    usdKrwRate,
    feeRates,
    purchaseFxBySymbol,
    displayCurrency,
    netSummary,
    visibleHoldingRows,
    hiddenTickers.size,
  ]);

  const totalPrincipalKrw = useMemo(() => {
    const totalEvalKrw = (holdingsTotalKrw ?? 0) + cashKrw;
    if (holdingsPnlDisplay == null || !Number.isFinite(holdingsPnlDisplay)) {
      return totalEvalKrw;
    }
    if (displayCurrency === "KRW") return totalEvalKrw - holdingsPnlDisplay;
    if (usdKrwRate != null && usdKrwRate > 0) {
      return totalEvalKrw - holdingsPnlDisplay * usdKrwRate;
    }
    return totalEvalKrw;
  }, [
    holdingsTotalKrw,
    cashKrw,
    holdingsPnlDisplay,
    displayCurrency,
    usdKrwRate,
  ]);

  const signedPnl = useCallback(
    (n: number | null | undefined) => {
      if (n == null || !Number.isFinite(n)) return "?";
      return formatSignedMoney(n, displayCurrency);
    },
    [displayCurrency],
  );

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
    let confirmMsg = withRebalanceAmountNote(
      ko.app.accountManageRebalanceNowConfirmGeneric,
    );
    try {
      const sched = await fetchTossRebalanceSchedule();
      const markets = (
        sched.schedule?.markets?.length ? sched.schedule.markets : ["kr", "us"]
      ).filter((m): m is "kr" | "us" => m === "kr" || m === "us");
      confirmMsg = buildRebalanceNowConfirmMessage(
        sched.preview?.plans ?? [],
        markets,
      );
    } catch {
      /* 미리보기 없으면 generic 확인 문구 */
    }
    if (!window.confirm(confirmMsg)) return;
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
      await loadRebalancePreview();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBuyingNow(false);
    }
  }, [buyingNow, reloadToss, loadRebalancePreview]);

  const buyNowToolbarAllowed = anySelectedMarketRegularOpen(["kr", "us"]);
  const buyNowToolbarSummaryInline = buildRebalanceSpendSummaryInline(
    rebalancePreviewPlans,
    rebalancePreviewMarkets,
  );
  const buyNowToolbarSummaryLead = buildRebalanceRunSummaryLead();
  const compactToolbarSpendLead = buildRebalanceSpendSummaryLead();
  const hasBuyNowToolbarSpendLines = rebalancePreviewMarkets.some((m) =>
    rebalancePreviewPlans.some((p) => p.market === m),
  );

  const renderRebalanceActionButtons = () => {
    const compact = true;
    const showCompactSpendSummary =
      compact && hasBuyNowToolbarSpendLines;
    const repeatSummaryInButtonSub = compact && Boolean(buyNowToolbarSummaryInline) && !showCompactSpendSummary;
    return (
    <div
      className={[
        "account-manage-tab__rebalance-actions",
        compact ? "account-manage-tab__rebalance-actions--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showCompactSpendSummary ? (
        <div
          className="account-manage-tab__rebalance-compact-summary"
          data-vu="account-rebalance-compact-summary"
        >
          <p className="account-manage-tab__rebalance-zone-summary-lead">
            {compactToolbarSpendLead}
          </p>
          <RebalanceSpendSummaryList
            plans={rebalancePreviewPlans}
            enabledMarkets={rebalancePreviewMarkets}
          />
        </div>
      ) : null}
      <div
        className={[
          "account-manage-tab__rebalance-zone",
          "account-manage-tab__rebalance-zone--preview",
          compact ? "account-manage-tab__rebalance-zone--compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {!compact ? (
          <span className="account-manage-tab__rebalance-zone-label">
            {ko.app.accountManageRebalancePreviewZoneLabel}
            <span className="account-rebalance-modal__sim-badge">
              {ko.app.accountManageRebalanceSimBadge}
            </span>
          </span>
        ) : null}
        <button
          type="button"
          className={[
            "bithumb-balance-hide-btn",
            "account-manage-tab__hide-btn",
            "account-manage-tab__hide-btn--summary",
            "account-manage-tab__hide-btn--schedule",
          ]
            .filter(Boolean)
            .join(" ")}
          data-vu="account-rebalance-open"
          aria-label={ko.app.accountManageRebalancePreviewZoneLabel}
          title={ko.app.accountManageRebalanceMarketHint}
          onClick={() => setRebalanceOpen(true)}
        >
          <span className="account-manage-tab__rebalance-btn-text">
            {ko.app.accountManageRebalanceOpen}
          </span>
          <span className="account-manage-tab__rebalance-btn-sub account-manage-tab__rebalance-btn-sub--safe">
            {buildRebalancePreviewSubLabel(buyNowToolbarSummaryInline, {
              repeatSummary: repeatSummaryInButtonSub,
            })}
          </span>
        </button>
      </div>
      <div
        className={[
          "account-manage-tab__rebalance-zone",
          "account-manage-tab__rebalance-zone--real",
          compact ? "account-manage-tab__rebalance-zone--compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {!compact ? (
          <>
            <span className="account-manage-tab__rebalance-zone-label account-manage-tab__rebalance-zone-label--real">
              {ko.app.accountManageRebalanceRealOrderZoneLabel}
              <span className="account-rebalance-modal__real-badge">
                {ko.app.accountManageRebalanceRealBadge}
              </span>
            </span>
            <p
              className={[
                "account-manage-tab__rebalance-zone-hint",
                buyNowToolbarAllowed
                  ? ""
                  : "account-manage-tab__rebalance-zone-hint--blocked",
              ]
                .filter(Boolean)
                .join(" ")}
              role={buyNowToolbarAllowed ? undefined : "status"}
            >
              {buyNowToolbarAllowed
                ? withRebalanceAmountNote(ko.app.accountManageRebalanceNowHoursHint)
                : ko.app.accountManageRebalanceNowHoursBlocked}
            </p>
            {buyNowToolbarAllowed && hasBuyNowToolbarSpendLines ? (
              <div
                className="account-manage-tab__rebalance-zone-summary"
                data-vu="account-rebalance-buy-now-summary"
              >
                <p className="account-manage-tab__rebalance-zone-summary-lead">
                  {buyNowToolbarSummaryLead}
                </p>
                <RebalanceSpendSummaryList
                  plans={rebalancePreviewPlans}
                  enabledMarkets={rebalancePreviewMarkets}
                />
              </div>
            ) : buyNowToolbarAllowed ? (
              <p
                className="account-manage-tab__rebalance-zone-summary"
                data-vu="account-rebalance-buy-now-summary"
              >
                {buyNowToolbarSummaryLead}
              </p>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className={[
            "bithumb-balance-hide-btn",
            "account-manage-tab__hide-btn",
            "account-manage-tab__hide-btn--summary",
            "account-manage-tab__hide-btn--real-order",
          ]
            .filter(Boolean)
            .join(" ")}
          data-vu="account-rebalance-buy-now-toolbar"
          disabled={buyingNow || !buyNowToolbarAllowed}
          aria-label={ko.app.accountManageRebalanceRealOrderZoneLabel}
          title={
            buyNowToolbarAllowed
              ? withRebalanceAmountNote(ko.app.accountManageRebalanceNowHoursHint)
              : ko.app.accountManageRebalanceNowHoursBlocked
          }
          onClick={() => void onBuyNowFromToolbar()}
        >
          <span className="account-manage-tab__rebalance-btn-text">
            {buyingNow
              ? ko.app.accountManageRebalanceNowRunning
              : ko.app.accountManageRebalanceNow}
          </span>
          {!buyingNow ? (
            <span className="account-manage-tab__rebalance-btn-sub account-manage-tab__rebalance-btn-sub--real">
              {buildRebalanceNowRunSubLabel(buyNowToolbarSummaryInline, {
                repeatSummary: repeatSummaryInButtonSub,
              })}
            </span>
          ) : null}
        </button>
      </div>
    </div>
    );
  };

  const showHoverBubble = useCallback(
    (key: string, clientX: number, clientY: number) => {
      const pad = 14;
      const approxW = 220;
      const approxH = 280;
      const x = Math.min(
        Math.max(8, clientX + pad),
        (typeof window !== "undefined" ? window.innerWidth : 800) - approxW,
      );
      const y = Math.min(
        Math.max(8, clientY - 12),
        (typeof window !== "undefined" ? window.innerHeight : 600) - approxH,
      );
      setHoverBubble({ key, x, y });
    },
    [],
  );

  const hideHoverBubble = useCallback(() => {
    setHoverBubble(null);
    setHoveredKey(null);
    setStyleHoveredKey(null);
  }, []);

  const clearChartFilters = useCallback(() => {
    setFocusKey(null);
    setStyleFocusKey(null);
    hideHoverBubble();
  }, [hideHoverBubble]);

  const pulseStyleCol = useCallback(() => {
    setStyleColHighlight(true);
    window.setTimeout(() => setStyleColHighlight(false), 2400);
  }, []);

  const onStyleChipClick = useCallback(
    (key: string) => {
      setFocusKey(null);
      setStyleFocusKey((prev) => (prev === key ? null : key));
      hideHoverBubble();
      if (key !== "__cash__") pulseStyleCol();
    },
    [hideHoverBubble, pulseStyleCol],
  );

  const scrollToStyleAssign = useCallback(() => {
    pulseStyleCol();
    holdingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pulseStyleCol]);

  const hoverSlice = useMemo(() => {
    if (!hoverBubble) return null;
    if (hoverBubble.key === "__holdings__") {
      return {
        key: "__holdings__",
        label: ko.app.accountManageHoldings,
        valueKrw: holdingsTotalKrw ?? 0,
        symbols: visibleHoldingRows.map((r) => r.symbol),
        count: visibleHoldingRows.length,
      };
    }
    return (
      styleSlices.find((s) => s.key === hoverBubble.key) ??
      slices.find((s) => s.key === hoverBubble.key) ??
      null
    );
  }, [
    hoverBubble,
    styleSlices,
    slices,
    holdingsTotalKrw,
    visibleHoldingRows,
  ]);

  const hoverSeg = hoverBubble
    ? hoverBubble.key === "__holdings__"
      ? {
          sector: "__holdings__",
          sectorKo: ko.app.accountManageHoldings,
          color: "var(--accent, #14b8a6)",
          pct:
            holdingsReturnPct != null && Number.isFinite(holdingsReturnPct)
              ? holdingsReturnPct
              : 100,
          a0: 0,
          a1: 0,
          count: visibleHoldingRows.length,
        }
      : (styleSegments.find((s) => s.sector === hoverBubble.key) ??
        segments.find((s) => s.sector === hoverBubble.key) ??
        null)
    : null;

  const hoverRows = useMemo(() => {
    if (!hoverSlice || hoverSlice.key === "__cash__") return [];
    if (hoverSlice.key === "__holdings__") {
      return [...visibleHoldingRows].sort((a, b) => b.valueKrw - a.valueKrw);
    }
    const set = new Set(hoverSlice.symbols.map((s) => s.toUpperCase()));
    return visibleHoldingRows
      .filter((r) => set.has(r.symbol.toUpperCase()))
      .sort((a, b) => b.valueKrw - a.valueKrw);
  }, [hoverSlice, visibleHoldingRows]);

  const hoverPnlKrw = useMemo(() => {
    if (!hoverSlice || hoverSlice.key === "__cash__") return null;
    if (hoverSlice.key === "__holdings__") return holdingsPnlDisplay;
    let sum = 0;
    let any = false;
    for (const r of hoverRows) {
      if (r.unrealizedPnlKrw == null || !Number.isFinite(r.unrealizedPnlKrw)) {
        continue;
      }
      sum += r.unrealizedPnlKrw;
      any = true;
    }
    if (!any) return null;
    return displayCurrency === "KRW" ? Math.round(sum) : sum;
  }, [hoverSlice, hoverRows, holdingsPnlDisplay, displayCurrency]);

  const hoverPnlAsKrw = useMemo(
    () => displayPnlToKrw(hoverPnlKrw, displayCurrency, usdKrwRate),
    [hoverPnlKrw, displayCurrency, usdKrwRate],
  );

  const hoverReturnPct = useMemo(() => {
    if (!hoverSlice || hoverSlice.key === "__cash__") return null;
    if (hoverSlice.key === "__holdings__") {
      return holdingsReturnPct != null && Number.isFinite(holdingsReturnPct)
        ? holdingsReturnPct
        : null;
    }
    if (hoverPnlAsKrw == null || !Number.isFinite(hoverPnlAsKrw)) return null;
    const mv = hoverSlice.valueKrw;
    if (!(mv > 0) || !Number.isFinite(mv)) return null;
    const cost = mv - hoverPnlAsKrw;
    if (!(cost > 0) || !Number.isFinite(cost)) return null;
    return (hoverPnlAsKrw / cost) * 100;
  }, [hoverSlice, hoverPnlAsKrw, holdingsReturnPct]);

  const bubbleRowReturnPct = useCallback(
    (r: AccountHoldingRow): number | null => {
      if (r.returnPercent != null && Number.isFinite(r.returnPercent)) {
        return r.returnPercent;
      }
      const pnlKrw = displayPnlToKrw(
        r.unrealizedPnlKrw,
        displayCurrency,
        usdKrwRate,
      );
      if (pnlKrw != null && r.valueKrw > 0) {
        const cost = r.valueKrw - pnlKrw;
        if (cost > 0 && Number.isFinite(cost)) {
          return (pnlKrw / cost) * 100;
        }
      }
      return null;
    },
    [displayCurrency, usdKrwRate],
  );

  const sliceReturnPct = useCallback(
    (slice: { key: string; symbols: string[]; valueKrw: number } | undefined) => {
      if (!slice || slice.key === "__cash__") return null;
      const set = new Set(slice.symbols.map((s) => s.toUpperCase()));
      let pnlSumDisplay = 0;
      let any = false;
      for (const r of visibleHoldingRows) {
        if (!set.has(r.symbol.toUpperCase())) continue;
        if (r.unrealizedPnlKrw == null || !Number.isFinite(r.unrealizedPnlKrw)) {
          continue;
        }
        pnlSumDisplay += r.unrealizedPnlKrw;
        any = true;
      }
      if (!any) return null;
      const pnlSum = displayPnlToKrw(
        pnlSumDisplay,
        displayCurrency,
        usdKrwRate,
      );
      if (pnlSum == null) return null;
      const mv = slice.valueKrw;
      if (!(mv > 0) || !Number.isFinite(mv)) return null;
      const cost = mv - pnlSum;
      if (!(cost > 0) || !Number.isFinite(cost)) return null;
      return (pnlSum / cost) * 100;
    },
    [visibleHoldingRows, displayCurrency, usdKrwRate],
  );

  const cx = 100;
  const cy = 100;
  const r0 = 52;
  const r1 = 88;

  const styleSegmentLabel = useCallback(
    (seg: { sector: string; sectorKo: string }) => {
      if (
        seg.sector === "__cash__" &&
        provider === "toss" &&
        (cashNativeKrw > 0 || cashNativeUsd > 0)
      ) {
        return ko.app.accountManageStyleCashSplit;
      }
      return seg.sectorKo;
    },
    [provider, cashNativeKrw, cashNativeUsd],
  );

  const activeChartFilter = useMemo(() => {
    if (styleFocusKey) {
      const seg = styleSegments.find((s) => s.sector === styleFocusKey);
      return {
        kind: "style" as const,
        label: seg ? styleSegmentLabel(seg) : styleFocusKey,
      };
    }
    if (focusKey) {
      const seg = segments.find((s) => s.sector === focusKey);
      return {
        kind: "weight" as const,
        label: seg?.sectorKo ?? focusKey,
      };
    }
    return null;
  }, [
    styleFocusKey,
    focusKey,
    styleSegments,
    segments,
    styleSegmentLabel,
  ]);

  const renderChartFilterBar = (
    extraClass?: string,
    kind?: "weight" | "style",
  ) => {
    if (!activeChartFilter) return null;
    if (kind && activeChartFilter.kind !== kind) return null;
    return (
      <div
        className={[
          "account-manage-tab__filter-bar",
          extraClass ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
        aria-live="polite"
        data-filter-kind={activeChartFilter.kind}
      >
        <span
          className={[
            "account-manage-tab__filter-label",
            activeChartFilter.kind === "style"
              ? "account-manage-tab__filter-label--style"
              : "account-manage-tab__filter-label--weight",
          ].join(" ")}
        >
          {activeChartFilter.kind === "style"
            ? ko.app.accountManageStyleFilterActive.replace(
                "{label}",
                activeChartFilter.label,
              )
            : ko.app.accountManageWeightFilterActive.replace(
                "{label}",
                activeChartFilter.label,
              )}
        </span>
        <button
          type="button"
          className="account-manage-tab__clear"
          onClick={clearChartFilters}
          aria-label={ko.app.accountManageClearFilter}
        >
          {ko.app.accountManageClearFilter}
        </button>
      </div>
    );
  };

  const snapshotSyncing = provider === "toss" ? tossSyncing : bithumbSyncing;
  const fetchActivity = refreshing || snapshotSyncing;

  useEffect(() => {
    if (!fetchActivity) {
      setSlowFetch(false);
      return;
    }
    const id = window.setTimeout(() => setSlowFetch(true), 2500);
    return () => window.clearTimeout(id);
  }, [fetchActivity]);

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
          <div className="account-manage-tab__head-copy">
            <h2 className="account-manage-tab__title">{ko.app.accountManageTitle}</h2>
            <p className="account-manage-tab__sub">{ko.app.accountManageLoginHint}</p>
          </div>
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
  const statusPending = status == null;
  const ready = provider === "toss" ? tossReady : bithumbReady;
  const hasAccountData =
    provider === "toss" ? Boolean(tossSnapshot) : Boolean(bithumbSnapshot);
  /** status pending/fail: still show portfolio when snapshot exists */
  const canShowAccount = hasAccountData || (!statusPending && ready);
  const summaryPending =
    canShowAccount && loading && !hasAccountData;
  const updatedAtMs =
    provider === "toss"
      ? quotesUpdatedAtMs ?? tossUpdatedAtMs
      : bithumbUpdatedAtMs;

  const contentReady =
    canShowAccount &&
    !loading &&
    hasAccountData;

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
        <h2 className="account-manage-tab__title">{ko.app.accountManageTitle}</h2>
        <div className="account-manage-tab__head-actions">
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
                <span className="btn-inline-spinner" aria-hidden />
                {ko.app.accountManageRefreshing}
              </>
            ) : (
              ko.app.accountManageRefresh
            )}
          </button>
        </div>
      </header>

      {!canShowAccount ? (
        statusPending || loading ? (
          <DockPanelCenterLoading label={ko.app.accountManageLoading} />
        ) : (
          <LiveTradeApiNotConnectedNotice exchange={provider} />
        )
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
            <div className="account-manage-tab__summary-frame">
              <div className="account-manage-tab__summary-controls">
                <div className="account-manage-tab__summary-controls-left">
                  <span
                    className="account-manage-tab__freshness"
                    role="status"
                    aria-live="polite"
                    aria-busy={fetchActivity || undefined}
                  >
                    {fetchActivity && slowFetch ? (
                      <span
                        className="account-manage-tab__refresh-spinner account-manage-tab__refresh-spinner--freshness"
                        aria-hidden
                      />
                    ) : null}
                    <span
                      className="account-manage-tab__freshness-text"
                      data-freshness-tick={freshnessTick}
                    >
                      {ko.app.accountManageUpdated}
                      {fetchActivity && slowFetch
                        ? ` · ${ko.app.accountManageRefreshing}`
                        : updatedAtMs
                          ? ` · ${formatUpdatedAt(updatedAtMs)}`
                          : fetchActivity
                            ? "…"
                            : ""}
                    </span>
                    {updatedAtMs ? (
                      <time
                        className="account-manage-tab__freshness-time"
                        dateTime={new Date(updatedAtMs).toISOString()}
                      >
                        {formatTimeMsKst(updatedAtMs)}
                      </time>
                    ) : null}
                  </span>
                  <div className="account-manage-tab__summary-controls-tools">
                    <AccountCurrencySlideToggle
                      value={displayCurrency}
                      onChange={setDisplayCurrency}
                      usdEnabled={usdKrwRate != null && usdKrwRate > 0}
                      usdRateTitle={
                        usdKrwRate != null && usdKrwRate > 0
                          ? ko.app.accountManageCurrencyUsdRate.replace(
                              "{rate}",
                              Math.round(usdKrwRate).toLocaleString("ko-KR"),
                            )
                          : undefined
                      }
                    />
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
                </div>
                {provider === "toss" ? (
                  <div
                    className="account-manage-tab__rebalance-hours"
                    role="group"
                    aria-label={ko.app.accountManageRebalanceMarkets}
                  >
                    {(["kr", "us"] as const).map((m) => {
                      const hoursOpen = isMarketRegularOpenClient(m);
                      const scheduleOn =
                        rebalanceScheduleEnabled &&
                        rebalancePreviewMarkets.includes(m);
                      return (
                        <span
                          key={m}
                          className={[
                            "account-manage-tab__rebalance-hour-chip",
                            m === "us" ? "is-usd" : "is-krw",
                          ].join(" ")}
                        >
                          <span className="account-manage-tab__rebalance-hour-top">
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
                          </span>
                          <span className="account-manage-tab__rebalance-hour-meta">
                            <span className="account-rebalance-modal__chip-meta-row">
                              <span className="account-rebalance-modal__chip-meta-label">
                                {ko.app.accountManageRebalanceMarketScheduleLabel}
                              </span>
                              <span
                                className={[
                                  "account-rebalance-modal__chip-state",
                                  scheduleOn ? "is-on" : "is-off",
                                ].join(" ")}
                              >
                                {scheduleOn
                                  ? ko.app.accountManageRebalanceMarketOnShort
                                  : ko.app.accountManageRebalanceMarketOffShort}
                              </span>
                            </span>
                            <span className="account-rebalance-modal__chip-meta-row">
                              <span className="account-rebalance-modal__chip-meta-label">
                                {ko.app.accountManageRebalanceMarketSessionLabel}
                              </span>
                              <span
                                className={[
                                  "account-rebalance-modal__chip-hours",
                                  hoursOpen ? "is-open" : "is-closed",
                                ].join(" ")}
                              >
                                {hoursOpen
                                  ? ko.app.accountManageRebalanceMarketRegularOpenShort
                                  : ko.app.accountManageRebalanceMarketRegularClosedShort}
                              </span>
                            </span>
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {provider === "toss" ? (
                <div
                  className="account-manage-tab__toolbar-rebalance"
                  role="group"
                  aria-label={ko.app.accountManageRebalanceTitle}
                >
                  {renderRebalanceActionButtons()}
                </div>
              ) : null}
            </div>
            {err && hasAccountData ? (
              <p className="account-manage-tab__stale-hint" role="status">
                {err}
              </p>
            ) : null}
          <div className="account-manage-tab__summary-row">
            <div className="account-manage-tab__summary account-manage-tab__summary--primary">
              <div
                className={[
                  "account-manage-tab__stat account-manage-tab__stat--trio",
                  !summaryPending &&
                  holdingsReturnPct != null &&
                  holdingsReturnPct > 0
                    ? "is-up"
                    : !summaryPending &&
                        holdingsReturnPct != null &&
                        holdingsReturnPct < 0
                      ? "is-down"
                      : !summaryPending &&
                          holdingsPnlDisplay != null &&
                          holdingsPnlDisplay > 0
                        ? "is-up"
                        : !summaryPending &&
                            holdingsPnlDisplay != null &&
                            holdingsPnlDisplay < 0
                          ? "is-down"
                          : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="account-manage-tab__stat-trio-item">
                  <span className="account-manage-tab__stat-label">
                    {ko.app.accountManageBubblePrincipal}
                  </span>
                  <span
                    className="account-manage-tab__stat-value account-manage-tab__money"
                    aria-hidden={balanceHidden || undefined}
                  >
                    {summaryPending ? "…" : money(totalPrincipalKrw)}
                  </span>
                </div>
                <div className="account-manage-tab__stat-trio-item">
                  <span className="account-manage-tab__stat-label">
                    {ko.app.accountManageChangePct}
                  </span>
                  <span className="account-manage-tab__stat-value">
                    {summaryPending
                      ? "…"
                      : holdingsReturnPct != null
                        ? `(${formatPercent(holdingsReturnPct)})`
                        : "—"}
                  </span>
                </div>
                <div className="account-manage-tab__stat-trio-item">
                  <span className="account-manage-tab__stat-label">
                    {ko.app.accountManageEvalAmount}
                  </span>
                  <span
                    className="account-manage-tab__stat-value account-manage-tab__money"
                    aria-hidden={balanceHidden || undefined}
                  >
                    {summaryPending
                      ? "…"
                      : money((holdingsTotalKrw ?? 0) + cashKrw)}
                  </span>
                </div>
              </div>
              <div
                className="account-manage-tab__stat account-manage-tab__stat--holdings"
                onMouseEnter={(e) => {
                  if (summaryPending || visibleHoldingRows.length === 0) return;
                  showHoverBubble("__holdings__", e.clientX, e.clientY);
                }}
                onMouseMove={(e) => {
                  if (summaryPending || visibleHoldingRows.length === 0) return;
                  showHoverBubble("__holdings__", e.clientX, e.clientY);
                }}
                onMouseLeave={hideHoverBubble}
              >
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
                        : !summaryPending &&
                            holdingsPnlDisplay != null &&
                            holdingsPnlDisplay > 0
                          ? "is-up"
                          : !summaryPending &&
                              holdingsPnlDisplay != null &&
                              holdingsPnlDisplay < 0
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
                  {!summaryPending &&
                  (holdingsReturnPct != null || holdingsPnlDisplay != null) ? (
                    <span
                      className="account-manage-tab__stat-pnl-line"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {holdingsPnlDisplay != null ? (
                        <span className="account-manage-tab__stat-pnl">
                          {signedPnl(holdingsPnlDisplay)}
                        </span>
                      ) : null}
                      {holdingsReturnPct != null ? (
                        <span className="account-manage-tab__stat-pct">
                          ({formatPercent(holdingsReturnPct)})
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </div>
              {provider === "toss" ? (
                <div
                  className="account-manage-tab__cash-group"
                  role="group"
                  aria-label={`${ko.app.accountManageCashKrw}, ${ko.app.accountManageCashUsd}`}
                >
                  <div
                    className="account-manage-tab__stat account-manage-tab__stat--cash account-manage-tab__stat--cash-krw"
                    role="group"
                    aria-label={accountCashStatAria(
                      ko.app.accountManageCashKrw,
                      formatPrice(cashNativeKrw, "KRW"),
                      balanceHidden,
                      summaryPending,
                      !summaryPending && cashKrwWeightPct != null
                        ? ko.app.accountManageCashWeight.replace(
                            "{pct}",
                            formatAllocPct(cashKrwWeightPct),
                          )
                        : undefined,
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
                      {!summaryPending && cashKrwWeightPct != null ? (
                        <span className="account-manage-tab__stat-sub">
                          {ko.app.accountManageCashWeight.replace(
                            "{pct}",
                            formatAllocPct(cashKrwWeightPct),
                          )}
                        </span>
                      ) : null}
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
                      [
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
                          : null,
                        !summaryPending && cashUsdWeightPct != null
                          ? ko.app.accountManageCashWeight.replace(
                              "{pct}",
                              formatAllocPct(cashUsdWeightPct),
                            )
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || undefined,
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
                      {!summaryPending && cashUsdWeightPct != null ? (
                        <span className="account-manage-tab__stat-sub">
                          {ko.app.accountManageCashWeight.replace(
                            "{pct}",
                            formatAllocPct(cashUsdWeightPct),
                          )}
                        </span>
                      ) : null}
                      {!summaryPending &&
                      cashNativeUsd > 0 &&
                      usdKrwRate != null &&
                      usdKrwRate > 0 ? (
                        <span className="account-manage-tab__stat-sub account-manage-tab__money">
                          {ko.app.accountManageCashUsdKrwHint.replace(
                            "{amount}",
                            formatPrice(
                              Math.round(cashNativeUsd * usdKrwRate),
                              "KRW",
                            ),
                          )}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
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
                    {!summaryPending && cashTotalWeightPct != null ? (
                      <span className="account-manage-tab__stat-sub">
                        {ko.app.accountManageCashWeight.replace(
                          "{pct}",
                          formatAllocPct(cashTotalWeightPct),
                        )}
                      </span>
                    ) : null}
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
          </div>

          {summaryPending ? (
            <DockPanelCenterLoading label={ko.app.accountManageLoading} />
          ) : err ? (
            <p className="account-manage-tab__error" role="alert">
              {err}
            </p>
          ) : (
            <>
          <div
            className={[
              "account-manage-tab__grid",
              styleSegments.length === 0
                ? "account-manage-tab__grid--no-style"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <aside
              ref={wheelRef}
              className={[
                "account-manage-tab__wheel card",
                styleFocusKey && !focusKey
                  ? "account-manage-tab__wheel--passive"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
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
                            d={donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)}
                            fill={seg.color}
                            onClick={() => {
                              setStyleFocusKey(null);
                              setFocusKey((prev) =>
                                prev === seg.sector ? null : seg.sector,
                              );
                              hideHoverBubble();
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
                      const shareChg = sliceShareChangePct(slice);
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
                              hideHoverBubble();
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
                              className={[
                                "account-manage-tab__legend-share-chg",
                                shareChg != null && shareChg > 0
                                  ? "is-up"
                                  : shareChg != null && shareChg < 0
                                    ? "is-down"
                                    : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              title={ko.app.accountManageWeightChange}
                            >
                              {shareChg != null
                                ? `(${formatPercent(shareChg)})`
                                : ""}
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
                <ul
                  className={[
                    "account-manage-tab__slice-list",
                    styleFocusKey && !focusKey
                      ? "account-manage-tab__slice-list--passive"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
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
                          hideHoverBubble();
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

              {focusKey ? (
                renderChartFilterBar(undefined, "weight")
              ) : styleFocusKey ? (
                <p className="account-manage-tab__hint account-manage-tab__hint--passive">
                  {ko.app.accountManageStyleFilterPassive}
                </p>
              ) : (
                <p className="account-manage-tab__hint">
                  {ko.app.accountManagePickHint} {ko.app.accountManageHoverHint}
                </p>
              )}
            </aside>

            {styleSegments.length > 0 ? (
              <aside
                className={[
                  "account-manage-tab__style-panel",
                  "card",
                  focusKey && !styleFocusKey
                    ? "account-manage-tab__style-panel--passive"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={ko.app.accountManageStyleChartTitle}
                data-vu="account-style-panel"
              >
                <div className="account-manage-tab__wheel-head">
                  <div>
                    <h3 className="account-manage-tab__wheel-title">
                      {ko.app.accountManageStyleChartTitle}
                    </h3>
                    <p className="account-manage-tab__wheel-sub account-manage-tab__style-sub">
                      {ko.app.accountManageStyleChartSub}
                    </p>
                    <p className="account-manage-tab__wheel-sub">
                      {ko.app.accountManageStyleNewDefaultHint}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="account-manage-tab__style-assign-link"
                    data-vu="account-style-assign-link"
                    onClick={scrollToStyleAssign}
                  >
                    {ko.app.accountManageStyleAssignLink}
                  </button>
                </div>
                {stylePolicyLines.length > 0 ? (
                  <details className="account-manage-tab__style-policy">
                    <summary>{ko.app.accountManageStylePolicyTitle}</summary>
                    <ol>
                      {stylePolicyLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                    <p>{ko.app.accountManageStylePolicyHint}</p>
                  </details>
                ) : null}
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
                            d={donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)}
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
                        ? styleSegmentLabel(
                            styleSegments.find((s) => s.sector === styleFocusKey) ?? {
                              sector: styleFocusKey,
                              sectorKo: "",
                            },
                          )
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
                      const slice = styleSlices.find((s) => s.key === seg.sector);
                      const mix = styleSourceCounts[seg.sector];
                      const retPct = sliceReturnPct(slice);
                      const retTone =
                        retPct != null
                          ? retPct > 0
                            ? "is-up"
                            : retPct < 0
                              ? "is-down"
                              : ""
                          : "";
                      return (
                        <li key={`style-leg-${seg.sector}`}>
                          <button
                            type="button"
                            className={[
                              "account-manage-tab__legend-btn",
                              "account-manage-tab__legend-btn--style",
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
                              {styleSegmentLabel(seg)}
                              {mix && (mix.auto > 0 || mix.specified > 0) ? (
                                <span className="account-manage-tab__style-chip-mix">
                                  {" "}
                                  {ko.app.accountManageStyleLegendMix
                                    .replace("{auto}", String(mix.auto))
                                    .replace("{specified}", String(mix.specified))}
                                </span>
                              ) : null}
                            </span>
                            <span className="account-manage-tab__legend-pct">
                              {formatAllocPct(seg.pct)}
                            </span>
                            <span
                              className={[
                                "account-manage-tab__legend-ret",
                                retTone,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              {retPct != null ? `(${formatPercent(retPct)})` : ""}
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
                <div
                  className="account-manage-tab__style-target"
                  data-vu="account-style-target"
                >
                  <div className="account-manage-tab__style-target-head">
                    <h4 className="account-manage-tab__style-target-title">
                      {ko.app.accountManageStyleTargetTitle}
                    </h4>
                    <p className="account-manage-tab__style-target-hint">
                      {ko.app.accountManageStyleTargetHint}
                    </p>
                  </div>
                  <div className="account-manage-tab__style-target-presets">
                    {(
                      [
                        [7, 3],
                        [8, 2],
                        [6, 4],
                        [5, 5],
                      ] as const
                    ).map(([g, v]) => {
                      const active =
                        styleTargetParts.growth === g &&
                        styleTargetParts.value === v;
                      const ratio = `${g}:${v}`;
                      return (
                        <button
                          key={ratio}
                          type="button"
                          className={[
                            "account-manage-tab__style-target-preset",
                            active ? "is-active" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-pressed={active}
                          aria-label={ko.app.accountManageStyleTargetPresetAria.replace(
                            "{ratio}",
                            ratio,
                          )}
                          onClick={() =>
                            setStyleTargetParts({ growth: g, value: v })
                          }
                        >
                          {ratio}
                        </button>
                      );
                    })}
                  </div>
                  <div className="account-manage-tab__style-target-inputs">
                    <label className="account-manage-tab__style-target-field">
                      <span>{ko.app.accountManageStyleTargetGrowth}</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        inputMode="numeric"
                        value={styleTargetParts.growth}
                        aria-label={ko.app.accountManageStyleTargetGrowth}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setStyleGrowthParts(Math.min(10, Math.max(0, Math.round(n))));
                        }}
                      />
                    </label>
                    <span className="account-manage-tab__style-target-colon" aria-hidden>
                      :
                    </span>
                    <label className="account-manage-tab__style-target-field">
                      <span>{ko.app.accountManageStyleTargetValue}</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        inputMode="numeric"
                        value={styleTargetParts.value}
                        aria-label={ko.app.accountManageStyleTargetValue}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const v = Math.min(10, Math.max(0, Math.round(n)));
                          setStyleTargetParts({
                            growth: 10 - v,
                            value: v,
                          });
                        }}
                      />
                    </label>
                    <span className="account-manage-tab__style-target-sum">
                      {ko.app.accountManageStyleTargetSumOk}
                    </span>
                  </div>
                  {styleTargetDrift ? (
                    <div className="account-manage-tab__style-target-stats">
                      <p>
                        {ko.app.accountManageStyleTargetCurrent
                          .replace(
                            "{growth}",
                            formatAllocPct(styleTargetDrift.currentGrowthPct),
                          )
                          .replace(
                            "{value}",
                            formatAllocPct(styleTargetDrift.currentValuePct),
                          )}
                      </p>
                      <p>
                        {ko.app.accountManageStyleTargetGoal
                          .replace(
                            "{growth}",
                            formatAllocPct(styleTargetDrift.targetGrowthPct),
                          )
                          .replace(
                            "{value}",
                            formatAllocPct(styleTargetDrift.targetValuePct),
                          )}
                      </p>
                      <p className="account-manage-tab__style-target-drift">
                        {ko.app.accountManageStyleTargetDrift
                          .replace(
                            "{growthDrift}",
                            formatDriftPctPoints(
                              styleTargetDrift.growthDriftPctPoints,
                            ),
                          )
                          .replace(
                            "{valueDrift}",
                            formatDriftPctPoints(
                              styleTargetDrift.valueDriftPctPoints,
                            ),
                          )}
                      </p>
                      {(() => {
                        const gAdd = styleTargetDrift.growthCapitalToAddKrw;
                        const vAdd = styleTargetDrift.valueCapitalToAddKrw;
                        const lines: string[] = [];
                        if (gAdd == null || vAdd == null) {
                          lines.push(ko.app.accountManageStyleTargetAddSellNeeded);
                        } else {
                          if (gAdd > 0.5) {
                            lines.push(
                              ko.app.accountManageStyleTargetAddGrowth.replace(
                                "{amount}",
                                money(gAdd),
                              ),
                            );
                          }
                          if (vAdd > 0.5) {
                            lines.push(
                              ko.app.accountManageStyleTargetAddValue.replace(
                                "{amount}",
                                money(vAdd),
                              ),
                            );
                          }
                          if (lines.length === 0) {
                            lines.push(ko.app.accountManageStyleTargetAddNone);
                          }
                        }
                        const need =
                          (gAdd != null && gAdd > 0 ? gAdd : 0) +
                          (vAdd != null && vAdd > 0 ? vAdd : 0);
                        return (
                          <>
                            <ul className="account-manage-tab__style-target-adds">
                              {lines.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                            {need > 0.5 && cashKrw > 0 ? (
                              <p className="account-manage-tab__style-target-cash">
                                {cashKrw >= need
                                  ? ko.app.accountManageStyleTargetCashCover.replace(
                                      "{amount}",
                                      money(need),
                                    )
                                  : ko.app.accountManageStyleTargetCashShort
                                      .replace("{amount}", money(need - cashKrw))
                                      .replace("{cash}", money(cashKrw))}
                              </p>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
                {styleFocusKey ? (
                  renderChartFilterBar(undefined, "style")
                ) : focusKey ? (
                  <p className="account-manage-tab__hint account-manage-tab__hint--passive">
                    {ko.app.accountManageWeightFilterPassive}
                  </p>
                ) : null}
              </aside>
            ) : null}

            <div className="account-manage-tab__holdings-stack">
            <section
              ref={holdingsRef}
              className="account-manage-tab__holdings card"
              id="account-holdings-table"
            >
              <div className="account-manage-tab__holdings-head">
                <h3 className="account-manage-tab__holdings-title">
                  {ko.app.accountManageTabList}
                </h3>
                {renderChartFilterBar("account-manage-tab__filter-bar--holdings")}
              </div>
              {listVisibleRows.length === 0 ? (
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
                        <th
                          id="account-holdings-style-col"
                          className={[
                            styleColHighlight || styleFocusKey
                              ? "account-manage-tab__style-col--highlight"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {ko.app.accountManageStyleCol}
                        </th>
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
                        <th>{ko.app.accountManageColHide}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listVisibleRows.map((row) => {
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
                              <div className="account-manage-tab__style-cell">
                                <span
                                  className={[
                                    "account-manage-tab__style-source",
                                    overrideStyle
                                      ? "account-manage-tab__style-source--specified"
                                      : "account-manage-tab__style-source--auto",
                                  ].join(" ")}
                                >
                                  {overrideStyle
                                    ? ko.app.accountManageStyleSpecified
                                    : ko.app.accountManageStyleAuto}
                                </span>
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
                                      {ko.app.accountManageStyleSpecifiedOption.replace(
                                        "{style}",
                                        ko.app.accountManageStyleGrowth,
                                      )}
                                    </option>
                                    <option value="value">
                                      {ko.app.accountManageStyleSpecifiedOption.replace(
                                        "{style}",
                                        ko.app.accountManageStyleValue,
                                      )}
                                    </option>
                                  </select>
                                </label>
                              </div>
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
                                      {signedPnl(row.unrealizedPnlKrw)}
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
                            <td>
                              <button
                                type="button"
                                className="account-manage-tab__hide-row-btn"
                                aria-pressed={false}
                                title={ko.app.accountManageHide}
                                onClick={() => toggleHidden(row.symbol)}
                              >
                                {ko.app.accountManageHide}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {hiddenHoldingRows.length > 0 ? (
              <section
                className={[
                  "account-manage-tab__holdings-hidden",
                  "card",
                  hiddenHoldingsOpen ? "is-open" : "is-collapsed",
                ].join(" ")}
                aria-label={ko.app.accountManageHiddenList}
              >
                <div className="account-manage-tab__holdings-head">
                  <button
                    type="button"
                    className="account-manage-tab__hidden-toggle"
                    aria-expanded={hiddenHoldingsOpen}
                    aria-controls="account-hidden-holdings-body"
                    aria-label={ko.app.accountManageHiddenListToggle}
                    onClick={() => setHiddenHoldingsOpen((v) => !v)}
                  >
                    <span
                      className={[
                        "account-manage-tab__hidden-chevron",
                        hiddenHoldingsOpen ? "is-open" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-hidden
                    >
                      ▼
                    </span>
                    <h3 className="account-manage-tab__holdings-title">
                      {ko.app.accountManageHiddenList}
                      <span className="account-manage-tab__hidden-count">
                        {ko.app.accountManageHiddenCount.replace(
                          "{n}",
                          String(hiddenHoldingRows.length),
                        )}
                      </span>
                    </h3>
                  </button>
                  <button
                    type="button"
                    className="account-manage-tab__clear-hidden"
                    onClick={clearHidden}
                  >
                    {ko.app.accountManageClearHidden}
                  </button>
                </div>
                {hiddenHoldingsOpen ? (
                  <div
                    id="account-hidden-holdings-body"
                    className="account-manage-tab__hidden-body"
                  >
                    <p className="account-manage-tab__hidden-hint">
                      {ko.app.accountManageHiddenListHint}
                    </p>
                    <div className="account-manage-tab__table-wrap account-manage-tab__table-wrap--hidden">
                      <table className="account-manage-tab__table">
                        <thead>
                          <tr>
                            <th>{ko.app.liveTradePfColSymbol}</th>
                            <th>{ko.app.accountManageGroupMarket}</th>
                            <th>{ko.app.liveTradePfColQty}</th>
                            <th>{ko.app.accountManageSliceValue}</th>
                            <th>{ko.app.liveTradePfReturn}</th>
                            <th>{ko.app.accountManageColHide}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hiddenHoldingRows.map((row) => (
                            <tr key={`hidden:${row.market}:${row.symbol}`}>
                              <td>
                                <strong>{row.symbol}</strong>
                                <div className="account-manage-tab__name">
                                  {row.name}
                                </div>
                              </td>
                              <td>
                                {row.market === "us"
                                  ? labels.marketUs
                                  : row.market === "crypto"
                                    ? labels.marketCrypto
                                    : labels.marketKr}
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
                                  row.returnPercent != null &&
                                  row.returnPercent > 0
                                    ? "is-up"
                                    : row.returnPercent != null &&
                                        row.returnPercent < 0
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
                                        aria-hidden={
                                          balanceHidden || undefined
                                        }
                                      >
                                        {signedPnl(row.unrealizedPnlKrw)}
                                      </span>
                                    ) : null}
                                    {row.returnPercent != null ? (
                                      <span className="account-manage-tab__return-pct">
                                        {row.unrealizedPnlKrw != null
                                          ? " "
                                          : null}
                                        ({formatPercent(row.returnPercent)})
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  "?"
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="account-manage-tab__hide-row-btn"
                                  aria-pressed={true}
                                  title={ko.app.accountManageUnhide}
                                  onClick={() => toggleHidden(row.symbol)}
                                >
                                  {ko.app.accountManageUnhide}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            </div>
          </div>

          {hoverBubble && hoverSlice && hoverSeg ? (
            <div
              className="account-manage-tab__bubble account-manage-tab__bubble--fixed"
              style={{ left: hoverBubble.x, top: hoverBubble.y }}
              role="tooltip"
            >
              <div className="account-manage-tab__bubble-head">
                <span
                  className="account-manage-tab__swatch"
                  style={{ background: hoverSeg.color }}
                />
                <strong>
                  {hoverSeg.sector === "__growth__" ||
                  hoverSeg.sector === "__value__" ||
                  hoverSeg.sector === "__cash__" ||
                  hoverSeg.sector === "__holdings__"
                    ? styleSegmentLabel(hoverSeg)
                    : hoverSlice.label}
                </strong>
              </div>
              {hoverSlice.key === "__cash__" ? (
                <div className="account-manage-tab__bubble-sym-row account-manage-tab__bubble-summary-row">
                  <span className="account-manage-tab__bubble-sym-name">
                    {ko.app.accountManageBubbleEval}
                  </span>
                  <span
                    className="account-manage-tab__bubble-sym-val account-manage-tab__money"
                    aria-hidden={balanceHidden || undefined}
                  >
                    {money(hoverSlice.valueKrw)}
                  </span>
                  <span className="account-manage-tab__bubble-sym-weight" />
                  <span className="account-manage-tab__bubble-sym-pnl" />
                  <span className="account-manage-tab__bubble-sym-pct" />
                </div>
              ) : (
                <>
                  <div className="account-manage-tab__bubble-sym-row account-manage-tab__bubble-summary-row">
                    <span className="account-manage-tab__bubble-sym-name">
                      {ko.app.accountManageBubblePrincipal}
                    </span>
                    <span
                      className="account-manage-tab__bubble-sym-val account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {money(
                        hoverPnlAsKrw != null &&
                          Number.isFinite(hoverSlice.valueKrw)
                          ? hoverSlice.valueKrw - hoverPnlAsKrw
                          : hoverSlice.valueKrw,
                      )}
                    </span>
                    <span className="account-manage-tab__bubble-sym-weight" />
                    <span className="account-manage-tab__bubble-sym-pnl" />
                    <span className="account-manage-tab__bubble-sym-pct" />
                  </div>
                  <div className="account-manage-tab__bubble-sym-row account-manage-tab__bubble-summary-row">
                    <span className="account-manage-tab__bubble-sym-name">
                      {ko.app.accountManageBubbleEval}
                    </span>
                    <span
                      className="account-manage-tab__bubble-sym-val account-manage-tab__money"
                      aria-hidden={balanceHidden || undefined}
                    >
                      {money(hoverSlice.valueKrw)}
                    </span>
                    <span className="account-manage-tab__bubble-sym-weight" />
                    <span
                      className={[
                        "account-manage-tab__bubble-sym-pnl",
                        hoverPnlKrw != null && hoverPnlKrw > 0
                          ? "is-up"
                          : hoverPnlKrw != null && hoverPnlKrw < 0
                            ? "is-down"
                            : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {hoverPnlKrw != null ? signedPnl(hoverPnlKrw) : ""}
                    </span>
                    <span
                      className={[
                        "account-manage-tab__bubble-sym-pct",
                        hoverReturnPct != null && hoverReturnPct > 0
                          ? "is-up"
                          : hoverReturnPct != null && hoverReturnPct < 0
                            ? "is-down"
                            : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {hoverReturnPct != null
                        ? `(${formatPercent(hoverReturnPct)})`
                        : ""}
                    </span>
                  </div>
                </>
              )}
              <div className="account-manage-tab__bubble-sym-row account-manage-tab__bubble-summary-row">
                <span className="account-manage-tab__bubble-sym-name">
                  {hoverBubble.key === "__holdings__"
                    ? ko.app.liveTradePfReturn
                    : ko.app.accountManageColWeight}
                </span>
                <span className="account-manage-tab__bubble-sym-val" />
                <span className="account-manage-tab__bubble-sym-weight">
                  {hoverBubble.key === "__holdings__" && holdingsReturnPct != null
                    ? formatPercent(holdingsReturnPct)
                    : formatAllocPct(hoverSeg.pct)}
                </span>
                <span className="account-manage-tab__bubble-sym-pnl" />
                <span className="account-manage-tab__bubble-sym-pct" />
              </div>
              {hoverSlice.key === "__cash__" ? (
                <div className="account-manage-tab__bubble-syms">
                  <div className="account-manage-tab__bubble-syms-label">
                    {ko.app.accountManageBubbleSymbols}
                  </div>
                  <ul>
                    {provider === "toss" ? (
                      <>
                        <li>
                          <span>{ko.app.accountManageCashKrw}</span>
                          <span
                            className="account-manage-tab__money"
                            aria-hidden={balanceHidden || undefined}
                          >
                            {formatPrice(cashNativeKrw, "KRW")}
                          </span>
                        </li>
                        <li>
                          <span>{ko.app.accountManageCashUsd}</span>
                          <span
                            className="account-manage-tab__money"
                            aria-hidden={balanceHidden || undefined}
                          >
                            {formatPrice(cashNativeUsd, "USD")}
                          </span>
                        </li>
                      </>
                    ) : (
                      <li>
                        <span>{ko.app.accountManageCash}</span>
                        <span
                          className="account-manage-tab__money"
                          aria-hidden={balanceHidden || undefined}
                        >
                          {money(cashKrw)}
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              ) : hoverRows.length > 0 ? (
                <div className="account-manage-tab__bubble-syms">
                  <div className="account-manage-tab__bubble-syms-label">
                    {ko.app.accountManageBubbleSymbols}
                  </div>
                  <ul className="account-manage-tab__bubble-syms-list">
                    {hoverRows.map((r) => {
                      const pct = bubbleRowReturnPct(r);
                      const pnl = r.unrealizedPnlKrw;
                      const weightPct =
                        total > 0 && Number.isFinite(r.valueKrw)
                          ? (r.valueKrw / total) * 100
                          : null;
                      const tone =
                        pct != null
                          ? pct > 0
                            ? "is-up"
                            : pct < 0
                              ? "is-down"
                              : ""
                          : pnl != null
                            ? pnl > 0
                              ? "is-up"
                              : pnl < 0
                                ? "is-down"
                                : ""
                            : "";
                      return (
                        <li
                          key={r.symbol}
                          className="account-manage-tab__bubble-sym-row"
                        >
                          <span className="account-manage-tab__bubble-sym-name">
                            {accountSymbolSliceLabel(r, r.symbol)}
                          </span>
                          <span
                            className="account-manage-tab__bubble-sym-val account-manage-tab__money"
                            aria-hidden={balanceHidden || undefined}
                          >
                            {money(r.valueKrw)}
                          </span>
                          <span className="account-manage-tab__bubble-sym-weight">
                            {weightPct != null ? formatAllocPct(weightPct) : ""}
                          </span>
                          <span
                            className={[
                              "account-manage-tab__bubble-sym-pnl",
                              tone,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {pnl != null ? signedPnl(pnl) : ""}
                          </span>
                          <span
                            className={[
                              "account-manage-tab__bubble-sym-pct",
                              tone,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {pct != null ? `(${formatPercent(pct)})` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

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
          onClose={() => {
            setRebalanceOpen(false);
            void loadRebalancePreview();
          }}
          onOrdersPlaced={() => {
            void reloadToss?.(true);
            void loadRebalancePreview();
          }}
        />
      ) : null}
    </div>
  );
}
