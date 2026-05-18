import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChartDrawMagnet } from "../hooks/useChartDrawMagnet";
import { fetchCryptoQuotes, fetchCryptoUniverse, fetchStock } from "../api";
import { CRYPTO_ASSETS, type CryptoAsset } from "../constants/crypto";
import { CHART_TIMEFRAMES } from "../constants/timeframes";
import { SHOW_PROFIT_MODEL_BUTTON } from "../constants/uiFlags";
import {
  formatPercent,
  formatPrice,
  formatSignedMoney,
  formatUpdatedAt,
} from "../lib/format";
import { computeProfitFromEntry } from "../lib/profitModel";
import { findChartTimeNearEntryMs } from "../lib/profitMarker";
import {
  getBrowserUserId,
  getPersistedProfitRow,
  persistProfitEntry,
  persistProfitSell,
} from "../lib/userPersist";
import type { ChartDrawMode, ChartDrawToolbarApi } from "../chartDrawTypes";
import ChartDrawToolbarButtons from "./ChartDrawToolbarButtons";
import StockChart from "./StockChart";
import TradingViewCryptoChart from "./TradingViewCryptoChart";
import PickQuoteStrip from "./PickQuoteStrip";
import ProfitModelModal from "./ProfitModelModal";
import { ko } from "../i18n/ko";
import type { Candle, ChartTimeframe, QuoteResponse } from "../types";

type ListQuoteMap = Partial<Record<string, QuoteResponse>>;

type CryptoChartEngine = "tradingview" | "app";

/** 좌측 코인 목록 시세 — 배치 API 우선, 실패 시 개별 폴백 (너무 촘촘하면 차트와 겹쳐 메인 스레드 과부하) */
const CRYPTO_LIST_POLL_MS = 5_000;
/** 거래량 상위 목록 재요청 (서버 캐시 60초) */
const CRYPTO_UNIVERSE_REFRESH_MS = 180_000;

function formatQuoteVolUsdt(v: number | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/** BTC-USDT → BTC */
function cryptoShortTicker(symbol: string): string {
  if (symbol.endsWith("-USDT")) return symbol.slice(0, -5);
  if (symbol.endsWith("-USD")) return symbol.slice(0, -4);
  return symbol;
}

function cryptoSymbolMatchesFocus(focusRaw: string, assetSymbol: string): boolean {
  const norm = (s: string) => s.trim().toUpperCase().replace(/-/g, "").replace(/\./g, "");
  const r = norm(focusRaw);
  const a = norm(assetSymbol);
  if (!r || !a) return false;
  if (a === r) return true;
  return norm(cryptoShortTicker(assetSymbol)) === r;
}

export type CryptoTabProps = {
  focusSymbol?: string | null;
  onFocusSymbolConsumed?: () => void;
};

export default function CryptoTab({
  focusSymbol = null,
  onFocusSymbolConsumed,
}: CryptoTabProps) {
  const [cryptoAssets, setCryptoAssets] = useState<CryptoAsset[]>(() => [
    ...CRYPTO_ASSETS,
  ]);
  const [symbol, setSymbol] = useState(CRYPTO_ASSETS[0]!.symbol);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1d");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dailyCandles, setDailyCandles] = useState<Candle[]>([]);
  const [chartInterval, setChartInterval] = useState("1d");
  const [candleCount, setCandleCount] = useState(0);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartStale, setChartStale] = useState(false);
  const [showMa, setShowMa] = useState(true);
  const [showIchimoku, setShowIchimoku] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [listQuotes, setListQuotes] = useState<ListQuoteMap>({});
  const [chartEngine, setChartEngine] = useState<CryptoChartEngine>("app");
  const [chartDrawMode, setChartDrawMode] = useState<ChartDrawMode>("cursor");
  const [chartDrawMagnet, setChartDrawMagnet] = useChartDrawMagnet();
  const chartDrawApiRef = useRef<ChartDrawToolbarApi | null>(null);
  const cryptoChartAbortRef = useRef<AbortController | null>(null);
  const [profitPersistTick, setProfitPersistTick] = useState(0);
  const [profitModalOpen, setProfitModalOpen] = useState(false);

  const chartOverlays = useMemo(
    () => ({
      ma: showMa,
      ichimoku: showIchimoku,
      volume: showVolume,
      rsi: showRsi,
    }),
    [showMa, showIchimoku, showVolume, showRsi],
  );

  const registerDrawApiStable = useCallback((api: ChartDrawToolbarApi | null) => {
    chartDrawApiRef.current = api;
  }, []);

  const browserUserId = useMemo(() => getBrowserUserId(), []);

  const symbolListKey = useMemo(
    () => cryptoAssets.map((a) => a.symbol).join(","),
    [cryptoAssets],
  );

  useEffect(() => {
    if (!focusSymbol?.trim() || !onFocusSymbolConsumed) return;
    const want = focusSymbol.trim();
    const hit = cryptoAssets.find((a) => cryptoSymbolMatchesFocus(want, a.symbol));
    if (hit) {
      setSymbol(hit.symbol);
      onFocusSymbolConsumed();
    }
  }, [focusSymbol, onFocusSymbolConsumed, cryptoAssets]);

  const active = useMemo(
    () => cryptoAssets.find((a) => a.symbol === symbol) ?? cryptoAssets[0]!,
    [symbol, cryptoAssets],
  );

  const loadChart = useCallback(
    async (sym: string, tf: ChartTimeframe, live = false) => {
      cryptoChartAbortRef.current?.abort();
      const ac = new AbortController();
      cryptoChartAbortRef.current = ac;

      if (!live) setChartLoading(true);
      setChartError(null);
      try {
        const data = await fetchStock(sym, tf, live, ac.signal);
        if (cryptoChartAbortRef.current !== ac) return;
        setQuote(data.quote);
        setCandles(data.candles);
        setDailyCandles(
          tf === "1d" ? data.candles : (data.dailyCandles ?? []),
        );
        setChartInterval(data.interval ?? tf);
        setCandleCount(data.candleCount ?? data.candles.length);
        setChartStale(Boolean(data.stale));
      } catch (err) {
        if (
          ac.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        if (cryptoChartAbortRef.current !== ac) return;
        setChartError(
          err instanceof Error ? err.message : ko.errors.chartLoad,
        );
        setChartStale(false);
        setQuote({
          symbol: sym,
          name: active.name,
          price: undefined,
          changePercent: undefined,
          currency: "USDT",
        });
        setCandles([]);
        setDailyCandles([]);
        setCandleCount(0);
      } finally {
        if (cryptoChartAbortRef.current === ac) {
          setChartLoading(false);
        }
      }
    },
    [active.name],
  );

  useEffect(() => {
    let cancelled = false;

    async function refreshUniverse() {
      try {
        const res = await fetchCryptoUniverse();
        if (cancelled || !res.assets?.length) return;
        setCryptoAssets(res.assets);
        setSymbol((prev) =>
          res.assets.some((a) => a.symbol === prev)
            ? prev
            : res.assets[0]!.symbol,
        );
      } catch {
        /* 기본 3종 유지 */
      }
    }

    void refreshUniverse();
    const id = window.setInterval(() => {
      void refreshUniverse();
    }, CRYPTO_UNIVERSE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const listAc = new AbortController();
    const symbols = cryptoAssets.map((a) => a.symbol);
    let inFlight = false;

    async function refreshListQuotes() {
      if (symbols.length === 0 || inFlight) return;
      inFlight = true;
      try {
        try {
          const res = await fetchCryptoQuotes(symbols);
          if (cancelled || listAc.signal.aborted) return;
          setListQuotes((prev) => {
            const next: ListQuoteMap = { ...prev };
            const pool = Object.values(res.quotes);
            for (const sym of symbols) {
              const up = sym.toUpperCase();
              let q: QuoteResponse | undefined =
                res.quotes[sym] ?? res.quotes[up];
              if (!q) {
                const want = up.replace(/-/g, "").replace(/\./g, "");
                q = pool.find(
                  (x) =>
                    String(x.symbol)
                      .toUpperCase()
                      .replace(/-/g, "")
                      .replace(/\./g, "") === want,
                );
              }
              if (q) next[sym] = { ...q, symbol: sym };
            }
            return next;
          });
          return;
        } catch {
          /* 배치 시세 실패 시 기존 경로 */
        }
        const entries = await Promise.all(
          symbols.map(async (sym) => {
            try {
              const data = await fetchStock(sym, "1m", true, listAc.signal);
              return [sym, data.quote] as const;
            } catch {
              return [sym, undefined] as const;
            }
          }),
        );
        if (cancelled || listAc.signal.aborted) return;
        setListQuotes((prev) => {
          const next: ListQuoteMap = { ...prev };
          for (const [sym, q] of entries) {
            if (q) next[sym] = q;
          }
          return next;
        });
      } finally {
        inFlight = false;
      }
    }

    void refreshListQuotes();
    const id = window.setInterval(() => {
      void refreshListQuotes();
    }, CRYPTO_LIST_POLL_MS);
    return () => {
      cancelled = true;
      listAc.abort();
      window.clearInterval(id);
    };
  }, [symbolListKey]);

  useEffect(() => {
    void loadChart(symbol, timeframe);
    const refreshMs = timeframe === "1m" ? 1_000 : 30_000;
    const id = window.setInterval(() => {
      void loadChart(symbol, timeframe, true);
    }, refreshMs);
    return () => {
      window.clearInterval(id);
      cryptoChartAbortRef.current?.abort();
    };
  }, [symbol, timeframe, loadChart]);

  useEffect(() => {
    setProfitModalOpen(false);
    setProfitPersistTick((t) => t + 1);
  }, [symbol]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (profitModalOpen) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = cryptoAssets.findIndex((a) => a.symbol === symbol);
      const next =
        e.key === "ArrowDown"
          ? Math.min(cryptoAssets.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx < 0 ? 0 : idx - 1);
      setSymbol(cryptoAssets[next]!.symbol);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [symbol, cryptoAssets, profitModalOpen]);

  const quotePx = quote?.price;
  const quoteCur = quote?.currency ?? "USDT";
  const profitRow = useMemo(
    () => getPersistedProfitRow(symbol),
    [symbol, profitPersistTick],
  );
  const profitEntry = profitRow?.entry ?? null;
  const profitModelResult = useMemo(
    () => computeProfitFromEntry(quotePx, profitEntry, profitRow?.exit),
    [quotePx, profitEntry, profitRow?.exit],
  );
  const profitMarker = useMemo(() => {
    if (profitEntry == null || !(profitEntry > 0)) return null;
    const ms = profitRow?.entryAtMs;
    if (!ms || candles.length === 0) return null;
    const t = findChartTimeNearEntryMs(ms, candles);
    if (!t) return null;
    return { time: t, price: profitEntry };
  }, [symbol, profitEntry, profitRow?.entryAtMs, candles]);
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
  const fitKey = `${symbol}:${timeframe}`;

  useEffect(() => {
    setChartDrawMode("cursor");
  }, [symbol, timeframe, chartInterval]);

  useEffect(() => {
    if (chartEngine === "tradingview") setChartDrawMode("cursor");
  }, [chartEngine]);

  return (
    <div className="workspace crypto-workspace">
      <aside
        className="picks-panel card crypto-panel"
        aria-label={ko.crypto.listAria}
      >
        <div className="panel-head">
          <span className="panel-head__title">{ko.crypto.panelTitle}</span>
        </div>
        <ul className="pick-list crypto-pick-list">
          {cryptoAssets.map((a) => {
            const isActive = a.symbol === symbol;
            const rowQ =
              listQuotes[a.symbol] ??
              (isActive ? (quote ?? undefined) : undefined);
            return (
              <li
                key={a.symbol}
                className={
                  isActive
                    ? "pick-item crypto-pick-item active"
                    : "pick-item crypto-pick-item"
                }
              >
                <button
                  type="button"
                  className="pick-row crypto-pick-row"
                  onClick={() => setSymbol(a.symbol)}
                >
                  <div className="crypto-pick-row__top">
                    <span className="crypto-pick-name" title={a.symbol}>
                      {a.name}
                    </span>
                  </div>
                  <div className="crypto-pick-row__metrics">
                    <span className="crypto-pick-ticker">
                      {cryptoShortTicker(a.symbol)}
                    </span>
                    <span
                      className="chart-toolbar__muted crypto-pick-vol"
                      title={ko.crypto.listVolTitle}
                    >
                      {ko.crypto.listVolShort} {formatQuoteVolUsdt(a.quoteVolume)}
                    </span>
                    <PickQuoteStrip
                      symbol={a.symbol}
                      price={rowQ?.price}
                      currency={rowQ?.currency ?? "USDT"}
                      changePercent={rowQ?.changePercent}
                      className="crypto-pick-quote"
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="chart-section crypto-chart-section">
        <div className="quote-bar card">
          <div className="quote-bar__info">
            <h2>{quote?.name ?? active.name}</h2>
            <PickQuoteStrip
              symbol={symbol}
              price={quote?.price}
              currency={quote?.currency ?? "USDT"}
              changePercent={quote?.changePercent}
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
                    className={timeframe === t.value ? "seg active" : "seg"}
                    onClick={() => setTimeframe(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {SHOW_PROFIT_MODEL_BUTTON && profitModelResult && profitEntry != null && (
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
                  chartEngine === "tradingview" ? "chip chip--on" : "chip"
                }
                onClick={() => setChartEngine("tradingview")}
              >
                {ko.crypto.chartEngineTv}
              </button>
              <button
                type="button"
                aria-pressed={chartEngine === "app"}
                className={chartEngine === "app" ? "chip chip--on" : "chip"}
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
            {chartEngine === "tradingview" && (
              <TradingViewCryptoChart
                key={`tv-${symbol}-${timeframe}`}
                yahooSymbol={symbol}
                timeframe={timeframe}
                assetName={active.name}
              />
            )}

            {chartEngine === "app" && chartLoading && (
              <p className="chart-status">{ko.app.chartLoading}</p>
            )}
            {chartEngine === "app" && chartError && !chartLoading && (
              <p className="chart-status chart-status--error" role="alert">
                {chartError}
              </p>
            )}
            {chartEngine === "app" &&
              !chartLoading &&
              !chartError &&
              candles.length === 0 && (
                <p className="chart-status">{ko.app.chartEmpty}</p>
              )}
            {chartEngine === "app" && !chartLoading && candles.length > 0 && (
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
                registerDrawApi={registerDrawApiStable}
                overlays={chartOverlays}
                profitMarker={profitMarker}
              />
            )}
          </div>
        </div>
      </section>

      {SHOW_PROFIT_MODEL_BUTTON && profitModalOpen && (
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
            persistProfitEntry(symbol, n, { entryAtMs });
            setProfitPersistTick((x) => x + 1);
          }}
          onClear={() => {
            persistProfitEntry(symbol, null);
            setProfitPersistTick((x) => x + 1);
            setProfitModalOpen(false);
          }}
          onRecordSell={() => {
            if (quotePx == null || !Number.isFinite(quotePx) || quotePx <= 0) {
              return;
            }
            persistProfitSell(symbol, quotePx);
            setProfitPersistTick((x) => x + 1);
          }}
        />
      )}
    </div>
  );
}
