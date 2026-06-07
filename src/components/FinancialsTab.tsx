import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFinancialPeriods,
  fetchFinancialStatementDetail,
  fetchStockFundamentals,
  fetchStockSearch,
  fetchStockSearchHot,
} from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice, formatTurnover } from "../lib/format";
import {
  tradingViewFinancialsUrl,
  yahooStockSymbolToTradingView,
} from "../lib/tradingviewSymbols";
import type {
  FinancialPeriodRow,
  FinancialStatementDetailResponse,
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
  if (kind === "ratio") return value.toFixed(2);
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

export default function FinancialsTab() {
  const [market, setMarket] = useState<Market>("kr");
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [quotes, setQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [hotQuotes, setHotQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<StockSearchQuoteRow | null>(null);
  const [fundamentals, setFundamentals] = useState<StockFundamentalsResponse | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundErr, setFundErr] = useState<string | null>(null);

  const [periods, setPeriods] = useState<FinancialPeriodRow[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsErr, setPeriodsErr] = useState<string | null>(null);

  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);
  const [statement, setStatement] = useState<FinancialStatementDetailResponse | null>(null);
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
    setHotLoading(true);

    void (async () => {
      try {
        const data = await fetchStockSearchHot(market, ac.signal);
        if (ac.signal.aborted) return;
        setHotQuotes(data.quotes ?? []);
      } catch (err: unknown) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHotQuotes([]);
      } finally {
        if (!ac.signal.aborted) setHotLoading(false);
      }
    })();

    const refreshId = window.setInterval(() => {
      void fetchStockSearchHot(market)
        .then((data) => setHotQuotes(data.quotes ?? []))
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
    setFundLoading(true);
    setFundErr(null);
    try {
      const data = await fetchStockFundamentals(symbol);
      if (seq !== fundSeqRef.current) return;
      setFundamentals(data);
    } catch (e) {
      if (seq !== fundSeqRef.current) return;
      setFundamentals(null);
      setFundErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === fundSeqRef.current) setFundLoading(false);
    }
  }, []);

  const loadPeriods = useCallback(async (symbol: string) => {
    const seq = ++periodsSeqRef.current;
    setPeriodsLoading(true);
    setPeriodsErr(null);
    setPeriods([]);
    setActivePeriodId(null);
    setStatement(null);
    setStatementErr(null);
    try {
      const data = await fetchFinancialPeriods(symbol);
      if (seq !== periodsSeqRef.current) return;
      setPeriods(data.periods ?? []);
    } catch (e) {
      if (seq !== periodsSeqRef.current) return;
      setPeriods([]);
      setPeriodsErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === periodsSeqRef.current) setPeriodsLoading(false);
    }
  }, []);

  const loadStatement = useCallback(async (symbol: string, periodId: string) => {
    const seq = ++statementSeqRef.current;
    setStatementLoading(true);
    setStatementErr(null);
    setStatement(null);
    try {
      const data = await fetchFinancialStatementDetail(symbol, periodId);
      if (seq !== statementSeqRef.current) return;
      setStatement(data);
    } catch (e) {
      if (seq !== statementSeqRef.current) return;
      setStatement(null);
      setStatementErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === statementSeqRef.current) setStatementLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected?.symbol) {
      setFundamentals(null);
      setFundErr(null);
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

  const selectedSym = selected?.symbol.trim().toUpperCase() ?? "";
  const listRows =
    debounced.length >= 1
      ? selectedSym
        ? quotes.filter((r) => r.symbol.trim().toUpperCase() !== selectedSym)
        : quotes
      : selectedSym
        ? hotQuotes.filter((r) => r.symbol.trim().toUpperCase() !== selectedSym)
        : hotQuotes;

  const metrics = fundamentals
    ? [
        { key: "per", label: ko.financials.per, value: fmtMetric(fundamentals.per, "ratio") },
        {
          key: "forwardPer",
          label: ko.financials.forwardPer,
          value: fmtMetric(fundamentals.forwardPer, "ratio"),
        },
        {
          key: "eps",
          label: ko.financials.eps,
          value: fmtMetric(fundamentals.eps, "eps", fundamentals.currency),
        },
        {
          key: "forwardEps",
          label: ko.financials.forwardEps,
          value: fmtMetric(fundamentals.forwardEps, "eps", fundamentals.currency),
        },
        {
          key: "bps",
          label: ko.financials.bps,
          value: fmtMetric(fundamentals.bps, "eps", fundamentals.currency),
        },
        { key: "pbr", label: ko.financials.pbr, value: fmtMetric(fundamentals.pbr, "ratio") },
        {
          key: "price",
          label: ko.financials.price,
          value: fmtMetric(fundamentals.price, "money", fundamentals.currency),
        },
        {
          key: "marketCap",
          label: ko.financials.marketCap,
          value: fmtMetric(fundamentals.marketCap, "money", fundamentals.currency),
        },
        {
          key: "dividendYield",
          label: ko.financials.dividendYield,
          value: fmtMetric(fundamentals.dividendYield, "percent"),
        },
        {
          key: "profitMargin",
          label: ko.financials.profitMargin,
          value: fmtMetric(fundamentals.profitMargin, "percent"),
        },
        {
          key: "roe",
          label: ko.financials.roe,
          value: fmtMetric(fundamentals.roe, "percent"),
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
          ) : fundLoading && !fundamentals ? (
            <p className="financials-tab__muted">{ko.financials.loading}</p>
          ) : fundErr ? (
            <p className="financials-tab__error" role="alert">
              {fundErr}
            </p>
          ) : fundamentals ? (
            <div className="financials-tab__detail-inner">
              <header className="financials-tab__head">
                <div className="financials-tab__head-text">
                  <h3 className="financials-tab__name">{fundamentals.name}</h3>
                  <p className="financials-tab__sym">
                    {fundamentals.symbol}
                    {tvSymbol ? ` · ${tvSymbol}` : ""}
                  </p>
                </div>
                {tvUrl ? (
                  <a
                    className="btn btn--secondary financials-tab__tv-link"
                    href={tvUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ko.financials.openTradingView}
                  </a>
                ) : null}
              </header>

              <table className="financials-tab__snapshot" aria-label={ko.financials.metricsAria}>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.key}>
                      <th scope="row">{m.label}</th>
                      <td>{m.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <section className="financials-tab__periods" aria-label={ko.financials.periodsTitle}>
                <h4 className="financials-tab__periods-title">{ko.financials.periodsTitle}</h4>
                {periodsLoading && periods.length === 0 ? (
                  <p className="financials-tab__muted">{ko.financials.periodsLoading}</p>
                ) : periodsErr ? (
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

              {activePeriodId ? (
                <section
                  className="financials-tab__statement"
                  aria-live="polite"
                  aria-busy={statementLoading}
                >
                  {statementLoading && !statement ? (
                    <p className="financials-tab__muted">{ko.financials.statementLoading}</p>
                  ) : statementErr ? (
                    <p className="financials-tab__error" role="alert">
                      {statementErr}
                    </p>
                  ) : statement ? (
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
                            <tbody>
                              {section.rows.map((row) => (
                                <tr key={`${section.title}:${row.label}`}>
                                  <th scope="row">{row.label}</th>
                                  <td>{row.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
