import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCryptoQuotes, fetchCryptoUniverse, fetchStock } from "../api";
import { CRYPTO_ASSETS, type CryptoAsset } from "../constants/crypto";
import { CHART_TIMEFRAMES } from "../constants/timeframes";
import StockChart from "./StockChart";
import TradingViewCryptoChart from "./TradingViewCryptoChart";
import PickQuoteStrip from "./PickQuoteStrip";
import { ko } from "../i18n/ko";
import type { Candle, ChartTimeframe, QuoteResponse } from "../types";

type ListQuoteMap = Partial<Record<string, QuoteResponse>>;

type CryptoChartEngine = "tradingview" | "app";

/** 좌측 코인 목록 시세 — 배치 API 우선, 실패 시 개별 폴백 */
const CRYPTO_LIST_POLL_MS = 1_000;
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

export default function CryptoTab() {
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

  const symbolListKey = useMemo(
    () => cryptoAssets.map((a) => a.symbol).join(","),
    [cryptoAssets],
  );

  const active = useMemo(
    () => cryptoAssets.find((a) => a.symbol === symbol) ?? cryptoAssets[0]!,
    [symbol, cryptoAssets],
  );

  const loadChart = useCallback(
    async (sym: string, tf: ChartTimeframe, live = false) => {
      if (!live) setChartLoading(true);
      setChartError(null);
      try {
        const data = await fetchStock(sym, tf, live);
        setQuote(data.quote);
        setCandles(data.candles);
        setDailyCandles(
          tf === "1d" ? data.candles : (data.dailyCandles ?? []),
        );
        setChartInterval(data.interval ?? tf);
        setCandleCount(data.candleCount ?? data.candles.length);
        setChartStale(Boolean(data.stale));
      } catch (err) {
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
        setChartLoading(false);
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
    const symbols = cryptoAssets.map((a) => a.symbol);

    async function refreshListQuotes() {
      if (symbols.length === 0) return;
      try {
        const res = await fetchCryptoQuotes(symbols);
        if (cancelled) return;
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
            const data = await fetchStock(sym, "1m", true);
            return [sym, data.quote] as const;
          } catch {
            return [sym, undefined] as const;
          }
        }),
      );
      if (cancelled) return;
      setListQuotes((prev) => {
        const next: ListQuoteMap = { ...prev };
        for (const [sym, q] of entries) {
          if (q) next[sym] = q;
        }
        return next;
      });
    }

    void refreshListQuotes();
    const id = window.setInterval(() => {
      void refreshListQuotes();
    }, CRYPTO_LIST_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbolListKey]);

  useEffect(() => {
    void loadChart(symbol, timeframe);
    const refreshMs = timeframe === "1m" ? 1_000 : 30_000;
    const id = window.setInterval(() => {
      void loadChart(symbol, timeframe, true);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [symbol, timeframe, loadChart]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
  }, [symbol, cryptoAssets]);

  const tfLabel =
    CHART_TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? timeframe;
  const fitKey = `${symbol}:${timeframe}`;

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
                      showSymbol={false}
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
                overlays={{
                  ma: showMa,
                  ichimoku: showIchimoku,
                  volume: showVolume,
                  rsi: showRsi,
                }}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
