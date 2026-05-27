import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { isNativeApp } from "../lib/isNativeApp";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import {
  fetchBoxRangeCatalog,
  fetchBoxRangeCatalogSymbol,
  fetchStock,
  type BoxRangeCatalogBox,
  type BoxRangeCatalogIndex,
  type BoxRangeCatalogMarket,
  type BoxRangeSymbolCatalog,
} from "../api";
import type { Candle, ChartTimeframe } from "../types";
import { formatPercent, formatPrice } from "../lib/format";
import { coerceBoxUnixTime } from "../lib/boxRangeChartPrimitive";
import { cryptoCoinIconUrl, cryptoIconSlug } from "../lib/cryptoCoinIcon";
import { krStockLogoUrl, usStockLogoUrl } from "../lib/stockLogoUrl";
import { ko } from "../i18n/ko";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import LiveTradeAuthPanel, {
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";
import StockChart from "./StockChart";

function fmtPrice(
  n: number | null | undefined,
  market: BoxRangeCatalogMarket,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (market === "crypto" || market === "kr") return formatPrice(n, "KRW");
  return formatPrice(n, "USD");
}

function isValidCatalogBox(b: BoxRangeCatalogBox): boolean {
  const top = Number(b.top);
  const bottom = Number(b.bottom);
  const mid = Number(b.mid);
  return (
    Number.isFinite(top) &&
    Number.isFinite(bottom) &&
    Number.isFinite(mid) &&
    top > bottom
  );
}

function displayTicker(symbol: string, market: BoxRangeCatalogMarket): string {
  if (market === "crypto") {
    const s = symbol.trim().toUpperCase();
    if (s.endsWith("-USDT")) return s.slice(0, -5);
    return s;
  }
  if (market === "kr") {
    return symbol.replace(/^KR_/i, "").trim();
  }
  return symbol.replace(/^US_/i, "").trim().toUpperCase();
}

function cryptoKoFromName(name: string): string {
  const slash = String(name ?? "").split("/");
  if (slash.length > 1) {
    const ko = slash[slash.length - 1].trim();
    if (/[\uAC00-\uD7A3]/.test(ko)) return ko;
  }
  const m = String(name ?? "").match(/[\uAC00-\uD7A3][\uAC00-\uD7A3·\s]*/);
  return m ? m[0].trim() : "";
}

/** 국내: 종목명 · 미국: 한글명(티커) · 코인: 한글명(티커) */
function displaySymbolLabel(
  symbol: string,
  name: string,
  market: BoxRangeCatalogMarket,
  nameKo?: string,
): string {
  const ticker = displayTicker(symbol, market);
  if (market === "kr") {
    const n = String(name ?? "").trim();
    return n || ticker;
  }
  if (market === "us") {
    const ko = String(nameKo ?? "").trim();
    return ko ? `${ko} (${ticker})` : ticker;
  }
  if (market === "crypto") {
    const ko = cryptoKoFromName(name);
    return ko ? `${ko} (${ticker})` : ticker;
  }
  return ticker;
}

function logoUrlForSymbol(
  symbol: string,
  market: BoxRangeCatalogMarket,
): string | null {
  if (market === "crypto") {
    const slug = cryptoIconSlug(symbol, "crypto");
    return slug ? cryptoCoinIconUrl(slug) : null;
  }
  if (market === "kr") {
    const bare = symbol
      .replace(/^KR_/i, "")
      .replace(/\.(KS|KQ)$/i, "")
      .trim();
    const code =
      /^\d{6}$/.test(bare) ? bare : symbol.replace(/^KR_/i, "").trim();
    return krStockLogoUrl(
      /^\d{6}$/.test(code) ? `KR_${code}` : symbol,
    );
  }
  return usStockLogoUrl(symbol);
}

function BoxRangeLogoButton({
  symbol,
  name,
  nameKo,
  eligibleCount,
  selected,
  market,
  onSelect,
}: {
  symbol: string;
  name: string;
  nameKo?: string;
  eligibleCount: number;
  selected: boolean;
  market: BoxRangeCatalogMarket;
  onSelect: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const logo = logoUrlForSymbol(symbol, market);
  const ticker = displayTicker(symbol, market);
  const label = displaySymbolLabel(symbol, name, market, nameKo);
  const showImg = Boolean(logo) && !imgFailed;

  return (
    <li className="box-range-tab__logo-item">
      <button
        type="button"
        className={
          selected
            ? "box-range-tab__logo-btn box-range-tab__logo-btn--on"
            : "box-range-tab__logo-btn"
        }
        aria-pressed={selected}
        title={`${name} (${ticker}) · ${ko.app.boxRangeTabValidCount} ${eligibleCount}`}
        onClick={onSelect}
      >
        {showImg ? (
          <img
            className="box-range-tab__logo-img"
            src={logo!}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="box-range-tab__logo-fallback" aria-hidden>
            {(name.trim() || ticker).slice(0, 1)}
          </span>
        )}
        <span className="box-range-tab__logo-ticker">{label}</span>
        {eligibleCount > 1 ? (
          <span className="box-range-tab__logo-badge" aria-hidden>
            {eligibleCount}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** Pine draw용 extMs가 초에 더해져 저장된 레거시 보정 */
const LEGACY_EXT_SEC_BUG: Record<"1h" | "4h" | "1d", number> = {
  "1h": 10 * 3600 * 1000,
  "4h": 8 * 14_400 * 1000,
  "1d": 6 * 86_400 * 1000,
};

function boxSpanUnixSec(
  leftRaw: unknown,
  rightRaw: unknown,
  timeframe: "1h" | "4h" | "1d",
): { left: number; right: number } | null {
  let left = coerceBoxUnixTime(leftRaw);
  let right = coerceBoxUnixTime(rightRaw);
  if (left == null || right == null) return null;
  const now = Math.floor(Date.now() / 1000);
  const bug = LEGACY_EXT_SEC_BUG[timeframe];
  if (bug > 0 && right > now + 3600 && right - left >= bug * 0.5) {
    const fixed = right - bug;
    if (fixed >= left && fixed <= now + 86_400) right = fixed;
  }
  if (right > now) right = now;
  if (left > right) {
    const t = left;
    left = right;
    right = t;
  }
  return { left, right };
}

function formatBoxPeriod(
  leftRaw: unknown,
  rightRaw: unknown,
  timeframe: "1h" | "4h" | "1d",
): string {
  const span = boxSpanUnixSec(leftRaw, rightRaw, timeframe);
  if (!span) return "—";
  const fmt = (sec: number) => {
    try {
      return new Date(sec * 1000).toLocaleDateString("ko-KR", {
        year: "2-digit",
        month: "numeric",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };
  return `${fmt(span.left)} ~ ${fmt(span.right)}`;
}

function boxPctFromMid(mid: number, target: number): number | null {
  if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(target)) return null;
  return ((target - mid) / mid) * 100;
}

const BOX_TF_ORDER = ["1h", "4h", "1d"] as const;
type BoxRangeViewTab = "cards" | "chart";

function BoxRangePriceCard({
  box,
  market,
  compact = false,
  selected = false,
  onSelect,
}: {
  box: BoxRangeCatalogBox;
  market: BoxRangeCatalogMarket;
  compact?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const tpPct = boxPctFromMid(box.mid, box.top);
  const slPct = boxPctFromMid(box.mid, box.bottom);
  return (
    <article
      className={[
        "box-range-tab__price-card",
        compact ? "box-range-tab__price-card--compact" : "",
        onSelect ? "box-range-tab__price-card--selectable" : "",
        selected ? "box-range-tab__price-card--on" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <header className="box-range-tab__price-card-head">
        <span className="box-range-tab__price-card-tf">{box.timeframe}</span>
        <span className="box-range-tab__price-card-tag">
          {ko.app.boxRangeCatalogTradeOn}
        </span>
      </header>
      <dl className="box-range-tab__price-card-metrics">
        <div className="box-range-tab__price-card-row box-range-tab__price-card-row--span">
          <dt>{ko.app.boxRangeTabBoxPeriod}</dt>
          <dd className="box-range-tab__price-card-val">
            {formatBoxPeriod(box.leftTime, box.rightTime, box.timeframe)}
            {box.validBars > 0 ? (
              <span className="box-range-tab__price-card-bars">
                {" "}
                · {box.validBars}봉
              </span>
            ) : null}
          </dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColMid}</dt>
          <dd className="box-range-tab__price-card-val">{fmtPrice(box.mid, market)}</dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColTp}</dt>
          <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--up">
            {fmtPrice(box.top, market)}
            {tpPct != null ? (
              <span className="box-range-tab__price-card-pct">
                {" "}
                {formatPercent(tpPct)}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColSl}</dt>
          <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--down">
            {fmtPrice(box.bottom, market)}
            {slPct != null ? (
              <span className="box-range-tab__price-card-pct">
                {" "}
                {formatPercent(slPct)}
              </span>
            ) : null}
          </dd>
        </div>
        {!compact ? (
          <>
            <div className="box-range-tab__price-card-row box-range-tab__price-card-row--hint">
              <dt>{ko.app.boxRangeTabExpectTp}</dt>
              <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--up">
                {tpPct != null ? formatPercent(tpPct) : "—"}
              </dd>
            </div>
            <div className="box-range-tab__price-card-row box-range-tab__price-card-row--hint">
              <dt>{ko.app.boxRangeTabExpectSl}</dt>
              <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--down">
                {slPct != null ? formatPercent(slPct) : "—"}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
    </article>
  );
}

export default function BoxRangeTab() {
  const nativeUi = isNativeApp();
  const { user, authChecked, registrationOpen } = useLiveTradeAuth();
  const [catalogMarket, setCatalogMarket] =
    useState<BoxRangeCatalogMarket>("us");
  const catalogStrategy = "pro-v2" as const;
  const [index, setIndex] = useState<BoxRangeCatalogIndex | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoxRangeSymbolCatalog | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [nativeTf, setNativeTf] = useState<"1h" | "4h" | "1d">("1h");
  const [viewTab, setViewTab] = useState<BoxRangeViewTab>("cards");
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1h");

  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartDailyCandles, setChartDailyCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const chartAbortRef = useRef<AbortController | null>(null);

  useMobileBackHandler(
    nativeUi && Boolean(selected),
    MOBILE_BACK_PRIORITY.BOX_RANGE_SYMBOL,
    () => setSelected(null),
  );

  const loadIndex = useCallback(async () => {
    setLoadErr(null);
    try {
      const data = await fetchBoxRangeCatalog(catalogMarket, {
        strategy: catalogStrategy,
      });
      setIndex(data);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      setIndex(null);
    }
  }, [catalogMarket, catalogStrategy]);

  useEffect(() => {
    if (!user) {
      setIndex(null);
      setSelected(null);
      setDetail(null);
      setSelectedBoxId(null);
      setViewTab("cards");
      return;
    }
    setSelected(null);
    setDetail(null);
    setSelectedBoxId(null);
    setViewTab("cards");
    void loadIndex();
  }, [user, loadIndex]);

  useEffect(() => {
    if (!selected || !user) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchBoxRangeCatalogSymbol(selected, catalogMarket, {
      strategy: catalogStrategy,
    })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
          setDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, user, catalogMarket, catalogStrategy]);

  const logoRows = useMemo(() => {
    const list = (index?.symbols ?? []).filter((r) => (r.boxCount ?? 0) > 0);
    const q = filter.trim().toUpperCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.symbol.includes(q) ||
        displayTicker(r.symbol, catalogMarket).includes(q) ||
        String(r.name ?? "")
          .toUpperCase()
          .includes(q),
    );
  }, [index, filter, catalogMarket]);

  const validBoxes = useMemo(
    () => (detail?.boxes ?? []).filter(isValidCatalogBox),
    [detail],
  );

  const nativeTfOptions = useMemo(() => {
    const set = new Set(validBoxes.map((b) => b.timeframe));
    return BOX_TF_ORDER.filter((tf) => set.has(tf));
  }, [validBoxes]);

  useEffect(() => {
    if (!nativeUi || nativeTfOptions.length === 0) return;
    if (!nativeTfOptions.includes(nativeTf)) {
      setNativeTf(nativeTfOptions[0]);
    }
  }, [nativeUi, nativeTfOptions, nativeTf]);

  const boxesToShow = useMemo(() => {
    if (!nativeUi) return validBoxes;
    return validBoxes.filter((b) => b.timeframe === nativeTf);
  }, [nativeUi, validBoxes, nativeTf]);

  useEffect(() => {
    setSelectedBoxId(null);
  }, [selected, detail?.symbol, catalogMarket, catalogStrategy]);

  const chartTimeframe: ChartTimeframe = useMemo(() => {
    const tf = nativeUi ? nativeTf : chartTf;
    return tf === "4h" || tf === "1d" ? tf : "1h";
  }, [nativeUi, nativeTf, chartTf]);

  useEffect(() => {
    if (!selected) return;
    if (nativeUi) {
      setChartTf(nativeTf);
      return;
    }
    const fallback = (validBoxes[0]?.timeframe ?? "1h") as ChartTimeframe;
    const picked = selectedBoxId
      ? (validBoxes.find((b) => b.catalogBoxId === selectedBoxId)?.timeframe as
          | ChartTimeframe
          | undefined)
      : undefined;
    const next = (picked ?? fallback) === "4h" || (picked ?? fallback) === "1d"
      ? (picked ?? fallback)
      : "1h";
    setChartTf(next);
  }, [selected, nativeUi, nativeTf, selectedBoxId, validBoxes]);

  const catalogOverlays = useMemo(
    () =>
      boxesToShow
        .filter((b) => b.timeframe === chartTimeframe)
        .map((b) => ({
          boxId: b.catalogBoxId,
          top: b.top,
          bottom: b.bottom,
          mid: b.mid,
          timeframe: b.timeframe,
          state: "catalog",
          leftTime: b.leftTime,
          rightTime: b.rightTime,
        })),
    [boxesToShow, chartTimeframe],
  );

  useEffect(() => {
    if (viewTab !== "chart" || !selected || !detail) return;
    const sym = String(detail.symbol ?? "").trim().toUpperCase();
    if (!sym) return;
    chartAbortRef.current?.abort();
    const ac = new AbortController();
    chartAbortRef.current = ac;
    setChartLoading(true);
    setChartErr(null);
    fetchStock(sym, chartTimeframe, true, ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        const c = Array.isArray(d?.candles) ? d.candles : [];
        const dc = Array.isArray((d as any)?.dailyCandles)
          ? (d as any).dailyCandles
          : [];
        setChartCandles(c as Candle[]);
        setChartDailyCandles(dc as Candle[]);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setChartCandles([]);
        setChartDailyCandles([]);
        setChartErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setChartLoading(false);
      });
    return () => ac.abort();
  }, [viewTab, selected, detail, chartTimeframe, fetchStock]);

  const rootClass = [
    "workspace",
    "box-range-tab",
    nativeUi ? "box-range-tab--native" : "",
    nativeUi && selected ? "box-range-tab--native-detail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!authChecked) {
    return (
      <div className="workspace box-range-tab">
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="workspace box-range-tab box-range-tab--guest">
        <p className="box-range-tab__hint">{ko.app.boxRangeTabLogin}</p>
        <LiveTradeAuthPanel
          user={null}
          registrationOpen={registrationOpen}
          onAuthChange={() => void loadIndex()}
        />
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <header
        className={
          nativeUi
            ? "box-range-tab__head card box-range-tab__head--compact"
            : "box-range-tab__head card"
        }
      >
        {!nativeUi ? (
          <p className="box-range-tab__hint">{ko.app.boxRangeTabHint}</p>
        ) : null}
        <div className="box-range-tab__head-controls">
        <div
          className="box-range-tab__market-segment live-trading-tab__segment"
          role="group"
          aria-label={ko.app.boxRangeTabMarketLabel}
        >
          <button
            type="button"
            className={
              catalogMarket === "us"
                ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                : "live-trading-tab__segment-btn"
            }
            aria-pressed={catalogMarket === "us"}
            onClick={() => setCatalogMarket("us")}
          >
            {ko.app.boxRangeTabMarketUs}
          </button>
          <button
            type="button"
            className={
              catalogMarket === "kr"
                ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                : "live-trading-tab__segment-btn"
            }
            aria-pressed={catalogMarket === "kr"}
            onClick={() => setCatalogMarket("kr")}
          >
            {ko.app.boxRangeTabMarketKr}
          </button>
          <button
            type="button"
            className={
              catalogMarket === "crypto"
                ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                : "live-trading-tab__segment-btn"
            }
            aria-pressed={catalogMarket === "crypto"}
            onClick={() => setCatalogMarket("crypto")}
          >
            {ko.app.boxRangeTabMarketCrypto}
          </button>
        </div>
        <div
          className="box-range-tab__market-segment live-trading-tab__segment"
          role="group"
          aria-label="전략"
        >
          <span className="box-range-tab__strategy-pill">PRO v2</span>
        </div>
        </div>
        {loadErr ? (
          <p className="live-trading-tab__err" role="alert">
            {loadErr}
          </p>
        ) : null}
      </header>

      <div className="box-range-tab__layout card">
        {(!nativeUi || !selected) && (
        <aside className="box-range-tab__logos" aria-label={ko.app.tabBoxRange}>
          <label className="box-range-tab__search-wrap">
            <span className="box-range-tab__search-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
                <path
                  d="M16 16l5 5"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              type="search"
              className="box-range-tab__search"
              placeholder={ko.app.boxRangeCatalogSearch}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={ko.app.boxRangeCatalogSearch}
            />
          </label>
          {!index ? (
            <DockPanelCenterLoading label={ko.app.boxRangeCatalogLoading} />
          ) : logoRows.length === 0 ? (
            <p className="box-range-tab__empty">{ko.app.boxRangeTabNoSymbols}</p>
          ) : (
            <ul className="box-range-tab__logo-grid">
              {logoRows.map((r) => (
                <BoxRangeLogoButton
                  key={r.symbol}
                  symbol={r.symbol}
                  name={r.name}
                  nameKo={r.nameKo}
                  eligibleCount={r.eligibleCount}
                  selected={selected === r.symbol}
                  market={catalogMarket}
                  onSelect={() => setSelected(r.symbol)}
                />
              ))}
            </ul>
          )}
        </aside>
        )}

        {(selected || !nativeUi) && (
        <section className="box-range-tab__detail" aria-live="polite">
          {!selected ? (
            nativeUi ? null : (
              <p className="box-range-tab__empty box-range-tab__pick-hint">
                {ko.app.boxRangeTabPickSymbol}
              </p>
            )
          ) : !detail ? (
            <DockPanelCenterLoading label={ko.app.boxRangeCatalogLoading} />
          ) : (
            <>
              {nativeUi ? (
                <div className="box-range-tab__detail-toolbar">
                  <button
                    type="button"
                    className="box-range-tab__native-back btn btn--ghost"
                    onClick={() => setSelected(null)}
                  >
                    ← {ko.app.boxRangeTabBackList}
                  </button>
                  <h2 className="box-range-tab__title box-range-tab__title--toolbar">
                    {displaySymbolLabel(
                      detail.symbol,
                      detail.name,
                      catalogMarket,
                    )}
                  </h2>
                </div>
              ) : (
                <h2 className="box-range-tab__title">
                  {detail.name}{" "}
                  <span className="box-range-tab__title-sym">
                    ({displayTicker(detail.symbol, catalogMarket)})
                  </span>
                </h2>
              )}
              {detail.scanError ? (
                <p className="live-trading-tab__err">{detail.scanError}</p>
              ) : null}
              {validBoxes.length === 0 ? (
                <p className="box-range-tab__empty">{ko.app.boxRangeTabNoValid}</p>
              ) : (
                <>
                  <div
                    className="box-range-tab__view-tabs live-trading-tab__segment"
                    role="tablist"
                    aria-label="보기"
                  >
                    <button
                      type="button"
                      role="tab"
                      className={
                        viewTab === "cards"
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-selected={viewTab === "cards"}
                      onClick={() => setViewTab("cards")}
                    >
                      카드
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={
                        viewTab === "chart"
                          ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                          : "live-trading-tab__segment-btn"
                      }
                      aria-selected={viewTab === "chart"}
                      onClick={() => setViewTab("chart")}
                    >
                      차트
                    </button>
                  </div>
                  {viewTab === "chart" ? (
                    <div
                      className="box-range-tab__chart-tf live-trading-tab__segment"
                      role="tablist"
                      aria-label="차트 시간봉"
                    >
                      {(["1h", "4h", "1d"] as const).map((tf) => (
                        <button
                          key={tf}
                          type="button"
                          role="tab"
                          className={
                            chartTimeframe === tf
                              ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                              : "live-trading-tab__segment-btn"
                          }
                          aria-selected={chartTimeframe === tf}
                          onClick={() => {
                            if (nativeUi) setNativeTf(tf);
                            setChartTf(tf);
                          }}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {nativeUi && nativeTfOptions.length > 1 ? (
                    <div
                      className="box-range-tab__tf-tabs"
                      role="tablist"
                      aria-label="시간봉"
                    >
                      {nativeTfOptions.map((tf) => (
                        <button
                          key={tf}
                          type="button"
                          role="tab"
                          className={
                            nativeTf === tf
                              ? "box-range-tab__tf-tab box-range-tab__tf-tab--on"
                              : "box-range-tab__tf-tab"
                          }
                          aria-selected={nativeTf === tf}
                          onClick={() => setNativeTf(tf)}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {viewTab === "cards" ? (
                    <div className="box-range-tab__card-grid box-range-tab__card-grid--cards">
                      {boxesToShow.map((b) => (
                        <BoxRangePriceCard
                          key={b.catalogBoxId}
                          box={b}
                          market={catalogMarket}
                          compact={nativeUi}
                          selected={selectedBoxId === b.catalogBoxId}
                          onSelect={() => setSelectedBoxId(b.catalogBoxId)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="box-range-tab__chart-wrap">
                      {selectedBoxId ? (
                        <p className="box-range-tab__chart-picked" role="status">
                          선택 박스:{" "}
                          {validBoxes.find((b) => b.catalogBoxId === selectedBoxId)
                            ?.timeframe ?? "—"}
                        </p>
                      ) : (
                        <p className="box-range-tab__chart-picked" role="status">
                          표시된 박스 {boxesToShow.length}개를 차트에 표시합니다.
                        </p>
                      )}
                      {chartLoading ? (
                        <p className="chart-status">{ko.app.chartLoading}</p>
                      ) : chartErr ? (
                        <p className="chart-status chart-status--error" role="alert">
                          {chartErr}
                        </p>
                      ) : chartCandles.length === 0 ? (
                        <p className="chart-status">{ko.app.chartEmpty}</p>
                      ) : (
                        <StockChart
                          colorMode="dark"
                          candles={chartCandles}
                          dailyCandles={chartDailyCandles}
                          fitKey={`${detail.symbol}:${chartTimeframe}:box-range`}
                          interval={chartTimeframe}
                          overlays={{
                            ma: false,
                            ichimoku: false,
                            volume: true,
                            rsi: false,
                          }}
                          boxRangeOverlays={catalogOverlays}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
        )}
      </div>
    </div>
  );
}
