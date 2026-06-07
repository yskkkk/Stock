import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchStockFundamentals, fetchStockSearch } from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice, formatTurnover } from "../lib/format";
import {
  tradingViewFinancialsUrl,
  yahooStockSymbolToTradingView,
} from "../lib/tradingviewSymbols";
import type { Market, StockFundamentalsResponse, StockSearchQuoteRow } from "../types";

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

function rowToPick(row: StockSearchQuoteRow) {
  return {
    symbol: row.symbol,
    name: row.name,
    market: row.market,
  };
}

export default function FinancialsTab() {
  const [market, setMarket] = useState<Market>("kr");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StockSearchQuoteRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<StockSearchQuoteRow | null>(null);
  const [fundamentals, setFundamentals] = useState<StockFundamentalsResponse | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundErr, setFundErr] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const fundSeqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      setSearchErr(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    debounceRef.current = window.setTimeout(() => {
      void fetchStockSearch(q, market)
        .then((res) => {
          setHits(res.quotes ?? []);
          setSearchErr(null);
        })
        .catch((e) => {
          setHits([]);
          setSearchErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setSearchLoading(false));
    }, 280);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [query, market]);

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

  useEffect(() => {
    if (!selected?.symbol) {
      setFundamentals(null);
      setFundErr(null);
      return;
    }
    void loadFundamentals(selected.symbol);
  }, [selected?.symbol, loadFundamentals]);

  const tvSymbol = useMemo(() => {
    if (!selected) return null;
    return yahooStockSymbolToTradingView(selected.symbol, selected.market);
  }, [selected]);

  const tvUrl = useMemo(() => {
    if (!selected || !tvSymbol) return null;
    return tradingViewFinancialsUrl(tvSymbol);
  }, [selected, tvSymbol]);

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
        <section className="financials-tab__panel card" aria-label={ko.financials.searchAria}>
          <div className="financials-tab__market-tabs" role="tablist">
            {(["kr", "us"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={market === m}
                className={market === m ? "financials-tab__market active" : "financials-tab__market"}
                onClick={() => setMarket(m)}
              >
                {m === "kr" ? ko.app.marketKr : ko.app.marketUs}
              </button>
            ))}
          </div>
          <label className="financials-tab__label" htmlFor="financials-q">
            {ko.financials.searchLabel}
          </label>
          <input
            id="financials-q"
            className="financials-tab__input"
            type="search"
            placeholder={ko.financials.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {searchLoading ? (
            <p className="financials-tab__muted">{ko.financials.loading}</p>
          ) : searchErr ? (
            <p className="financials-tab__error" role="alert">
              {searchErr}
            </p>
          ) : hits.length === 0 && query.trim() ? (
            <p className="financials-tab__muted">{ko.financials.noHits}</p>
          ) : (
            <ul className="financials-tab__hits">
              {hits.map((row) => (
                <li key={row.symbol}>
                  <button
                    type="button"
                    className={
                      selected?.symbol === row.symbol
                        ? "financials-tab__hit financials-tab__hit--active"
                        : "financials-tab__hit"
                    }
                    onClick={() => setSelected(row)}
                  >
                    <span className="financials-tab__hit-name">{row.name}</span>
                    <span className="financials-tab__hit-sym">{row.symbol}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="financials-tab__panel card" aria-label={ko.financials.metricsAria}>
          {!selected ? (
            <p className="financials-tab__muted financials-tab__idle">{ko.financials.idle}</p>
          ) : fundLoading && !fundamentals ? (
            <p className="financials-tab__muted">{ko.financials.loading}</p>
          ) : fundErr ? (
            <p className="financials-tab__error" role="alert">
              {fundErr}
            </p>
          ) : fundamentals ? (
            <>
              <header className="financials-tab__head">
                <div>
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

              <dl className="financials-tab__metrics">
                {metrics.map((m) => (
                  <div key={m.key} className="financials-tab__metric">
                    <dt>{m.label}</dt>
                    <dd>{m.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
