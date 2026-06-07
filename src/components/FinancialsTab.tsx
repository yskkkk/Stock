import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFinancialPeriods,
  fetchFinancialStatementAnalysis,
  fetchStockFundamentals,
  fetchStockSearch,
} from "../api";
import {
  loadStockSearchHot,
  peekStockSearchHotPrefetch,
} from "../lib/tabPrefetch";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice, formatTurnover } from "../lib/format";
import {
  tradingViewFinancialsUrl,
  yahooStockSymbolToTradingView,
} from "../lib/tradingviewSymbols";
import { fmtFinancialStatementCell } from "../lib/fmtFinancialStatement";
import type {
  FinancialPeriodMetrics,
  FinancialPeriodRow,
  FinancialPeriodsResponse,
  FinancialStatementAnalysisResponse,
  Market,
  StockFundamentalsResponse,
  StockPick,
  StockSearchQuoteRow,
} from "../types";
import StockSearchHotRow, { rowToStockPick } from "./StockSearchHotRow";

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;
const HOT_REFRESH_MS = 120_000;

function looksUsAlternateQuery(q: string) {
  return /[A-Za-z]/.test(q);
}

function looksKrAlternateQuery(q: string) {
  const t = q.trim();
  if (/^\d{1,6}$/.test(t)) return true;
  return HANGUL_RE.test(t);
}

function fmtMetric(
  value: number | null | undefined,
  kind: "ratio" | "money" | "percent" | "eps",
  currency?: string,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "ratio") return `${value.toFixed(2)}배`;
  if (kind === "percent") return formatPercent(value * 100);
  if (kind === "eps") {
    return currency === "KRW"
      ? `${Math.round(value).toLocaleString("ko-KR")}원`
      : formatPrice(value, currency);
  }
  if (kind === "money") {
    if (currency === "KRW") return formatTurnover(value, "KRW");
    return formatPrice(value, currency);
  }
  return String(value);
}

function periodKindLabel(kind: FinancialPeriodRow["kind"]) {
  return kind === "annual" ? ko.financials.periodAnnual : ko.financials.periodQuarter;
}

function fmtYoyPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function yoyClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || Math.abs(pct) < 0.05) {
    return "financials-tab__yoy";
  }
  return pct > 0
    ? "financials-tab__yoy financials-tab__yoy--up"
    : "financials-tab__yoy financials-tab__yoy--down";
}

export default function FinancialsTab() {
  const [market, setMarket] = useState<Market>("kr");
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [quotes, setQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [hotQuotes, setHotQuotes] = useState<StockSearchQuoteRow[]>(
    () => peekStockSearchHotPrefetch(market) ?? [],
  );
  const [hotLoading, setHotLoading] = useState(
    () => peekStockSearchHotPrefetch(market) == null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<StockSearchQuoteRow | null>(null);
  const [fundamentals, setFundamentals] = useState<StockFundamentalsResponse | null>(null);
  const [periodsMeta, setPeriodsMeta] = useState<Pick<
    FinancialPeriodsResponse,
    "name" | "symbol" | "currency" | "market"
  > | null>(null);

  const [periods, setPeriods] = useState<FinancialPeriodRow[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsErr, setPeriodsErr] = useState<string | null>(null);

  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);
  const [statement, setStatement] = useState<FinancialStatementAnalysisResponse | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementErr, setStatementErr] = useState<string | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);
  const fundSeqRef = useRef(0);
  const periodsSeqRef = useRef(0);
  const statementSeqRef = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(input.trim()), 260);
    return () => window.clearTimeout(id);
  }, [input]);

  useEffect(() => {
    if (debounced.length >= 1) {
      setHotQuotes([]);
      setHotLoading(false);
      return;
    }

    const ac = new AbortController();
    const cached = peekStockSearchHotPrefetch(market);
    if (cached != null) {
      setHotQuotes(cached);
      setHotLoading(false);
    } else {
      setHotLoading(true);
    }

    void (async () => {
      try {
        const quotes = await loadStockSearchHot(market);
        if (ac.signal.aborted) return;
        setHotQuotes(quotes ?? []);
      } catch (err: unknown) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHotQuotes([]);
      } finally {
        if (!ac.signal.aborted) setHotLoading(false);
      }
    })();

    const refreshId = window.setInterval(() => {
      void loadStockSearchHot(market)
        .then((quotes) => setHotQuotes(quotes ?? []))
        .catch(() => {});
    }, HOT_REFRESH_MS);

    return () => {
      ac.abort();
      window.clearInterval(refreshId);
    };
  }, [debounced, market]);

  useEffect(() => {
    if (debounced.length < 1) {
      setQuotes([]);
      setError(null);
      setLoading(false);
      return;
    }

    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const primary = await fetchStockSearch(debounced, market, ac.signal);
        if (ac.signal.aborted) return;
        if (primary.quotes.length > 0) {
          setQuotes(primary.quotes);
          return;
        }

        const alt: Market = market === "kr" ? "us" : "kr";
        const tryAlt =
          (market === "kr" && looksUsAlternateQuery(debounced)) ||
          (market === "us" && looksKrAlternateQuery(debounced));
        if (!tryAlt) {
          setQuotes([]);
          return;
        }

        const secondary = await fetchStockSearch(debounced, alt, ac.signal);
        if (ac.signal.aborted) return;
        if (secondary.quotes.length > 0) {
          setMarket(alt);
          setQuotes(secondary.quotes);
        } else {
          setQuotes([]);
        }
      } catch (err: unknown) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQuotes([]);
        setError(err instanceof Error ? err.message : ko.app.stockLookupError);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [debounced, market]);

  const loadFundamentals = useCallback(async (symbol: string) => {
    const seq = ++fundSeqRef.current;
    try {
      const data = await fetchStockFundamentals(symbol);
      if (seq !== fundSeqRef.current) return;
      setFundamentals(data);
    } catch {
      if (seq !== fundSeqRef.current) return;
      setFundamentals(null);
    }
  }, []);

  const loadStatement = useCallback(async (symbol: string, periodId: string) => {
    const seq = ++statementSeqRef.current;
    setStatementLoading(true);
    setStatementErr(null);
    try {
      const data = await fetchFinancialStatementAnalysis(symbol, periodId);
      if (seq !== statementSeqRef.current) return;
      setStatement(data);
    } catch (e) {
      if (seq !== statementSeqRef.current) return;
      setStatementErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === statementSeqRef.current) setStatementLoading(false);
    }
  }, []);

  const loadPeriods = useCallback(
    async (symbol: string) => {
      const seq = ++periodsSeqRef.current;
      setPeriodsLoading(true);
      setPeriodsErr(null);
      setPeriods([]);
      setPeriodsMeta(null);
      setActivePeriodId(null);
      setStatement(null);
      setStatementErr(null);
      try {
        const data = await fetchFinancialPeriods(symbol);
        if (seq !== periodsSeqRef.current) return;
        setPeriods(data.periods ?? []);
        setPeriodsMeta({
          name: data.name,
          symbol: data.symbol,
          currency: data.currency,
          market: data.market,
        });
        const first = data.periods?.[0];
        if (first) {
          setActivePeriodId(first.id);
          void loadStatement(symbol, first.id);
        }
      } catch (e) {
        if (seq !== periodsSeqRef.current) return;
        setPeriods([]);
        setPeriodsErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === periodsSeqRef.current) setPeriodsLoading(false);
      }
    },
    [loadStatement],
  );

  useEffect(() => {
    if (!selected?.symbol) {
      setFundamentals(null);
      setPeriodsMeta(null);
      setPeriods([]);
      setPeriodsErr(null);
      setActivePeriodId(null);
      setStatement(null);
      setStatementErr(null);
      return;
    }
    void loadFundamentals(selected.symbol);
    void loadPeriods(selected.symbol);
  }, [selected?.symbol, loadFundamentals, loadPeriods]);

  const handleSelectPick = useCallback((pick: StockPick) => {
    setSelected({
      symbol: pick.symbol,
      name: pick.name,
      market: pick.market,
      nameKo: pick.nameKo,
      nameEn: pick.nameEn,
      price: pick.price,
      changePercent: pick.changePercent,
      currency: pick.currency,
      turnover: pick.turnover,
    });
  }, []);

  const handleMarketChange = useCallback((next: Market) => {
    if (next === market) return;
    setMarket(next);
    setInput("");
    setDebounced("");
    setQuotes([]);
    setSelected(null);
    setError(null);
  }, [market]);

  const handlePeriodClick = useCallback(
    (period: FinancialPeriodRow) => {
      if (!selected?.symbol) return;
      setActivePeriodId(period.id);
      void loadStatement(selected.symbol, period.id);
    },
    [selected?.symbol, loadStatement],
  );

  const tvSymbol = useMemo(() => {
    if (!selected) return null;
    return yahooStockSymbolToTradingView(selected.symbol, selected.market);
  }, [selected]);

  const tvUrl = useMemo(() => {
    if (!selected || !tvSymbol) return null;
    return tradingViewFinancialsUrl(tvSymbol);
  }, [selected, tvSymbol]);

  const statementMarket: "kr" | "us" | undefined =
    selected?.market === "kr" || selected?.market === "us" ? selected.market : undefined;

  const selectedSym = selected?.symbol.trim().toUpperCase() ?? "";
  const listRows =
    debounced.length >= 1
      ? selectedSym
        ? quotes.filter((r) => r.symbol.trim().toUpperCase() !== selectedSym)
        : quotes
      : selectedSym
        ? hotQuotes.filter((r) => r.symbol.trim().toUpperCase() !== selectedSym)
        : hotQuotes;

  const activePeriod = useMemo(
    () => periods.find((p) => p.id === activePeriodId) ?? null,
    [periods, activePeriodId],
  );

  const periodMetrics: FinancialPeriodMetrics | null = useMemo(() => {
    const pm = statement?.periodMetrics;
    if (!pm) return null;
    if (pm.periodId === activePeriodId) return pm;
    if (statementLoading) return null;
    return pm;
  }, [statement?.periodMetrics, activePeriodId, statementLoading]);

  const displayName =
    periodsMeta?.name ?? fundamentals?.name ?? selected?.name ?? "";
  const displaySymbol = periodsMeta?.symbol ?? fundamentals?.symbol ?? selected?.symbol ?? "";
  const metricsCurrency =
    periodMetrics?.currency ?? fundamentals?.currency ?? periodsMeta?.currency;

  const metrics = periodMetrics
    ? [
        { key: "per", label: ko.financials.per, value: fmtMetric(periodMetrics.per, "ratio") },
        {
          key: "forwardPer",
          label: ko.financials.forwardPer,
          value: fmtMetric(
            periodMetrics.forwardPer ?? (periodMetrics.isForecast ? fundamentals?.forwardPer : null),
            "ratio",
          ),
        },
        {
          key: "eps",
          label: ko.financials.eps,
          value: fmtMetric(periodMetrics.eps, "eps", metricsCurrency),
        },
        {
          key: "forwardEps",
          label: ko.financials.forwardEps,
          value: fmtMetric(
            periodMetrics.forwardEps ??
              (periodMetrics.isForecast ? fundamentals?.forwardEps : null),
            "eps",
            metricsCurrency,
          ),
        },
        {
          key: "bps",
          label: ko.financials.bps,
          value: fmtMetric(periodMetrics.bps, "eps", metricsCurrency),
        },
        {
          key: "pbr",
          label: ko.financials.pbr,
          value: fmtMetric(periodMetrics.pbr, "ratio"),
        },
        {
          key: "price",
          label: ko.financials.price,
          value: fmtMetric(fundamentals?.price ?? periodMetrics.price, "money", metricsCurrency),
        },
        {
          key: "marketCap",
          label: ko.financials.marketCap,
          value: fmtMetric(fundamentals?.marketCap ?? periodMetrics.marketCap, "money", metricsCurrency),
        },
        {
          key: "dividendYield",
          label: ko.financials.dividendYield,
          value: fmtMetric(
            periodMetrics.dividendYield ?? fundamentals?.dividendYield,
            "percent",
          ),
        },
        {
          key: "profitMargin",
          label: ko.financials.profitMargin,
          value: fmtMetric(periodMetrics.profitMargin, "percent"),
        },
        {
          key: "roe",
          label: ko.financials.roe,
          value: fmtMetric(periodMetrics.roe, "percent"),
        },
      ]
    : [];

  return (
    <div className="workspace financials-tab">
      <div className="financials-tab__grid">
        <section
          className="financials-tab__panel card financials-tab__search"
          aria-label={ko.financials.searchAria}
        >
          <div className="panel-head panel-head--lookup-hot">
            <div className="panel-head__filters panel-head__filters--lookup-hot panel-head__filters--lookup-center">
              <div className="market-tabs">
                {(["kr", "us"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={market === m ? "market-tab active" : "market-tab"}
                    onClick={() => handleMarketChange(m)}
                  >
                    {m === "kr" ? ko.app.marketKr : ko.app.marketUs}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="stock-search-tab">
            <div className="pick-toolbar stock-search-tab__toolbar">
              <input
                id="financials-q"
                type="search"
                className="pick-search"
                placeholder={ko.app.stockLookupPlaceholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const first = quotes[0] ?? hotQuotes[0];
                  if (first) handleSelectPick(rowToStockPick(first));
                }}
                aria-label={ko.app.stockLookupAria}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {selected ? (
              <ul
                className="pick-list stock-search-tab__list stock-search-tab__selected-pin"
                aria-label={ko.app.stockLookupSelectedPin}
              >
                <StockSearchHotRow
                  row={selected}
                  isActive
                  onSelectPick={handleSelectPick}
                />
              </ul>
            ) : null}

            {loading && (
              <p className="picks-empty picks-empty--muted">{ko.app.stockLookupLoading}</p>
            )}
            {!loading && error && (
              <p className="picks-empty picks-empty--warn" role="alert">
                {error}
              </p>
            )}
            {!loading && !error && debounced.length < 1 && (
              <>
                {hotLoading && listRows.length === 0 && !selected ? (
                  <p className="picks-empty picks-empty--muted">
                    {ko.app.stockLookupHotLoading}
                  </p>
                ) : listRows.length > 0 ? (
                  <ul className="pick-list stock-search-tab__list stock-search-tab__hot-list">
                    {listRows.map((row) => (
                      <StockSearchHotRow
                        key={row.symbol}
                        row={row}
                        isActive={selected?.symbol === row.symbol}
                        onSelectPick={handleSelectPick}
                      />
                    ))}
                  </ul>
                ) : !selected ? (
                  <p className="picks-empty">{ko.app.stockLookupIdle}</p>
                ) : null}
              </>
            )}
            {!loading && !error && debounced.length >= 1 && quotes.length === 0 && (
              <p className="picks-empty">{ko.app.stockLookupNoHits}</p>
            )}
            {!loading && !error && debounced.length >= 1 && listRows.length > 0 && (
              <ul className="pick-list stock-search-tab__list stock-search-tab__hot-list">
                {listRows.map((row) => (
                  <StockSearchHotRow
                    key={row.symbol}
                    row={row}
                    isActive={selected?.symbol === row.symbol}
                    onSelectPick={handleSelectPick}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          className="financials-tab__panel card financials-tab__detail"
          aria-label={ko.financials.metricsAria}
        >
          {!selected ? (
            <p className="financials-tab__muted financials-tab__idle">{ko.financials.idle}</p>
          ) : periodsLoading && periods.length === 0 ? (
            <p className="financials-tab__muted">{ko.financials.loading}</p>
          ) : (
            <div className="financials-tab__detail-inner">
              <header className="financials-tab__head">
                <div className="financials-tab__head-text">
                  <h3 className="financials-tab__name">{displayName}</h3>
                  <p className="financials-tab__sym">
                    {displaySymbol}
                    {tvSymbol ? ` · ${tvSymbol}` : ""}
                  </p>
                </div>
                {tvUrl ? (
                  <a
                    className="financials-tab__tv-link"
                    href={tvUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ko.financials.openTradingView}
                  </a>
                ) : null}
              </header>

              <section
                className="financials-tab__periods financials-tab__periods--primary"
                aria-label={ko.financials.periodsTitle}
              >
                <h4 className="financials-tab__periods-title">{ko.financials.periodsTitle}</h4>
                {periodsErr ? (
                  <p className="financials-tab__error" role="alert">
                    {periodsErr}
                  </p>
                ) : periods.length === 0 ? (
                  <p className="financials-tab__muted">{ko.financials.periodsEmpty}</p>
                ) : (
                  <div className="financials-tab__period-grid">
                    {periods.map((period) => {
                      const isActive = activePeriodId === period.id;
                      return (
                        <button
                          key={period.id}
                          type="button"
                          className={
                            isActive
                              ? "financials-tab__period-card financials-tab__period-card--active"
                              : "financials-tab__period-card"
                          }
                          aria-pressed={isActive}
                          onClick={() => handlePeriodClick(period)}
                        >
                          <span className="financials-tab__period-label">{period.label}</span>
                          <span className="financials-tab__period-badges">
                            <span className="financials-tab__period-kind">
                              {periodKindLabel(period.kind)}
                            </span>
                            {period.isForecast ? (
                              <span className="financials-tab__period-forecast">
                                {ko.financials.periodForecast}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {(activePeriodId || periodMetrics) ? (
                <section
                  className={
                    statementLoading
                      ? "financials-tab__snapshot-wrap financials-tab__snapshot-wrap--loading"
                      : "financials-tab__snapshot-wrap"
                  }
                  aria-label={ko.financials.metricsAria}
                  aria-busy={statementLoading}
                >
                  <h4 className="financials-tab__snapshot-title">
                    {ko.financials.metricsAria}
                    {activePeriod ? (
                      <span className="financials-tab__snapshot-period">
                        {" "}
                        · {activePeriod.label}
                        {activePeriod.isForecast ? ` ${ko.financials.periodForecast}` : ""}
                      </span>
                    ) : null}
                  </h4>
                  {statementLoading && !periodMetrics ? (
                    <p className="financials-tab__muted">{ko.financials.statementLoading}</p>
                  ) : (
                    <>
                      <table className="financials-tab__snapshot">
                        <tbody>
                          {metrics.map((m) => (
                            <tr key={m.key}>
                              <th scope="row">{m.label}</th>
                              <td>{m.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="financials-tab__snapshot-note">
                        {ko.financials.metricsCurrentPriceNote}
                      </p>
                    </>
                  )}
                </section>
              ) : null}

              {(activePeriodId || statement) ? (
                <section
                  className={
                    statementLoading
                      ? "financials-tab__statement financials-tab__statement--loading"
                      : "financials-tab__statement"
                  }
                  aria-live="polite"
                  aria-busy={statementLoading}
                >
                  {statementErr ? (
                    <p
                      className="financials-tab__error financials-tab__statement-err"
                      role="alert"
                    >
                      {statementErr}
                    </p>
                  ) : null}
                  {statement ? (
                    <>
                      <header className="financials-tab__statement-head">
                        <h4 className="financials-tab__statement-title">
                          {statement.label}
                          <span className="financials-tab__statement-kind">
                            {periodKindLabel(statement.kind)}
                          </span>
                          {statement.isForecast ? (
                            <span className="financials-tab__period-forecast">
                              {ko.financials.periodForecast}
                            </span>
                          ) : null}
                        </h4>
                        <p className="financials-tab__statement-source">
                          {ko.financials.statementSource}: {statement.source}
                          {statement.priorPeriodLabel
                            ? ` · ${ko.financials.statementPriorHint} (${statement.priorPeriodLabel})`
                            : ""}
                        </p>
                      </header>
                      {statement.sections.map((section) => (
                        <div key={section.title} className="financials-tab__statement-section">
                          <div className="financials-tab__statement-section-head">
                            <h5>{section.title}</h5>
                            {section.unitNote ? (
                              <span className="financials-tab__statement-unit">{section.unitNote}</span>
                            ) : null}
                          </div>
                          <table className="financials-tab__statement-table">
                            <thead>
                              <tr>
                                <th scope="col">{ko.financials.statementItem}</th>
                                <th scope="col">{statement.label}</th>
                                <th scope="col">
                                  {statement.priorPeriodLabel ?? ko.financials.statementPrior}
                                </th>
                                <th scope="col">{ko.financials.statementYoy}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.rows.map((row) => (
                                <tr key={`${section.title}:${row.label}`}>
                                  <th scope="row">{row.label}</th>
                                  <td>
                                    {fmtFinancialStatementCell(
                                      row.value,
                                      row.label,
                                      section.unitNote,
                                      statementMarket,
                                    )}
                                  </td>
                                  <td>
                                    {fmtFinancialStatementCell(
                                      row.priorValue,
                                      row.label,
                                      section.unitNote,
                                      statementMarket,
                                    )}
                                  </td>
                                  <td className={yoyClass(row.yoyPct)}>{fmtYoyPct(row.yoyPct)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}

                      {statement.aiOpinion ? (
                        <section className="financials-tab__ai" aria-label={ko.financials.aiOpinionTitle}>
                          <h4 className="financials-tab__ai-title">{ko.financials.aiOpinionTitle}</h4>
                          <p className="financials-tab__ai-summary">{statement.aiOpinion.summary}</p>
                          <ul className="financials-tab__ai-list">
                            {statement.aiOpinion.bullets.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                          <p className="financials-tab__ai-disclaimer">{statement.aiOpinion.disclaimer}</p>
                        </section>
                      ) : null}
                    </>
                  ) : statementLoading ? (
                    <p className="financials-tab__muted">{ko.financials.statementLoading}</p>
                  ) : null}
                </section>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
