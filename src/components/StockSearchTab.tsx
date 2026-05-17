import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStockSearch } from "../api";
import { ko } from "../i18n/ko";
import type { Market, StockPick, StockSearchQuoteRow } from "../types";
import PickQuoteStrip from "./PickQuoteStrip";

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;

function looksUsAlternateQuery(q: string) {
  return /[A-Za-z]/.test(q);
}

function looksKrAlternateQuery(q: string) {
  const t = q.trim();
  if (/^\d{1,6}$/.test(t)) return true;
  return HANGUL_RE.test(t);
}

function marketStateLabel(ms: string | undefined): string | null {
  if (!ms?.trim()) return null;
  const u = ms.trim().toUpperCase();
  if (u === "REGULAR") return ko.app.stockLookupMktRegular;
  if (u === "CLOSED") return ko.app.stockLookupMktClosed;
  if (u === "PRE" || u === "PREMARKET" || u === "PRE_MARKET")
    return ko.app.stockLookupMktPre;
  if (u === "POST" || u === "POSTMARKET" || u === "POST_MARKET")
    return ko.app.stockLookupMktPost;
  return null;
}

export interface StockSearchTabProps {
  market: Market;
  selectedSymbol: string | null;
  onSelectPick: (pick: StockPick) => void;
  /** 교차 시장 검색으로 탭을 맞출 때 */
  onLookupMarketChange: (market: Market) => void;
}

function rowToPick(row: StockSearchQuoteRow): StockPick {
  const pick: StockPick = {
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    score: 0,
    signals: [],
  };
  const koName = row.nameKo?.trim();
  const enName = row.nameEn?.trim();
  if (koName) pick.nameKo = koName;
  if (enName) pick.nameEn = enName;
  if (row.price != null && Number.isFinite(row.price)) pick.price = row.price;
  if (row.changePercent != null && Number.isFinite(row.changePercent)) {
    pick.changePercent = row.changePercent;
  }
  if (row.currency?.trim()) pick.currency = row.currency.trim();
  return pick;
}

/** 검색창에 심볼만 넣고 Enter 했을 때 최소 `StockPick` 추정 */
function pickFromDirectInput(raw: string, market: Market): StockPick | null {
  const t = raw.trim();
  if (!t) return null;
  if (market === "kr") {
    if (/^\d{1,6}$/.test(t)) {
      const code = t.padStart(6, "0");
      return {
        symbol: `${code}.KS`,
        name: code,
        market: "kr",
        score: 0,
        signals: [],
      };
    }
    if (/^\d{6}\.(KS|KQ)$/i.test(t)) {
      const sym = t.toUpperCase();
      return { symbol: sym, name: sym, market: "kr", score: 0, signals: [] };
    }
  }
  const sym = t.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9.\-^]{1,24}$/.test(sym)) return null;
  return { symbol: sym, name: sym, market, score: 0, signals: [] };
}

export default function StockSearchTab({
  market,
  selectedSymbol,
  onSelectPick,
  onLookupMarketChange,
}: StockSearchTabProps) {
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [quotes, setQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(input.trim()), 320);
    return () => window.clearTimeout(id);
  }, [input]);

  useEffect(() => {
    if (debounced.length < 1) {
      setQuotes([]);
      setError(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
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
          onLookupMarketChange(alt);
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
  }, [debounced, market, onLookupMarketChange]);

  const tryDirectSubmit = useCallback(() => {
    const pick = pickFromDirectInput(input, market);
    if (pick) onSelectPick(pick);
  }, [input, market, onSelectPick]);

  return (
    <div className="stock-search-tab">
      <div className="pick-toolbar stock-search-tab__toolbar">
        <input
          type="search"
          className="pick-search"
          placeholder={ko.app.stockLookupPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (quotes.length > 0) {
              onSelectPick(rowToPick(quotes[0]));
              return;
            }
            tryDirectSubmit();
          }}
          aria-label={ko.app.stockLookupAria}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {loading && (
        <p className="picks-empty picks-empty--muted">{ko.app.stockLookupLoading}</p>
      )}
      {!loading && error && (
        <p className="picks-empty picks-empty--warn" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && debounced.length < 1 && (
        <p className="picks-empty">{ko.app.stockLookupIdle}</p>
      )}
      {!loading && !error && debounced.length >= 1 && quotes.length === 0 && (
        <p className="picks-empty">{ko.app.stockLookupNoHits}</p>
      )}
      {!loading && !error && quotes.length > 0 && (
        <ul className="pick-list stock-search-tab__list">
          {quotes.map((row) => {
            const pick = rowToPick(row);
            const active = selectedSymbol === row.symbol;
            const showKo =
              row.market === "us" &&
              row.nameKo &&
              row.nameKo.trim() !== "" &&
              row.nameKo.trim() !== row.name.trim();
            const showEn =
              row.market === "us" &&
              row.nameEn &&
              row.nameEn.trim() !== "" &&
              row.nameEn.trim() !== row.name.trim() &&
              row.nameEn.trim() !== (row.nameKo ?? "").trim();
            const msLabel = marketStateLabel(row.marketState);
            const hasPrice = row.price != null && Number.isFinite(row.price);
            return (
              <li
                key={row.symbol}
                className={active ? "pick-item active" : "pick-item"}
              >
                <button
                  type="button"
                  className="pick-row stock-search-tab__row"
                  onClick={() => onSelectPick(pick)}
                >
                  <div className="stock-search-tab__row-top">
                    <div className="stock-search-tab__row-left">
                      <span className="pick-name" title={row.name}>
                        {row.name}
                      </span>
                      {(showKo || showEn) && (
                        <div className="stock-search-tab__subnames">
                          {showKo ? (
                            <span className="stock-search-tab__name-ko">
                              {row.nameKo}
                            </span>
                          ) : null}
                          {showEn ? (
                            <span className="stock-search-tab__name-en">
                              {row.nameEn}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className="stock-search-tab__row-right">
                      <span
                        className="stock-search-tab__sym"
                        title={row.symbol}
                      >
                        {row.symbol}
                      </span>
                      {hasPrice ? (
                        <PickQuoteStrip
                          symbol={row.symbol}
                          price={row.price}
                          currency={row.currency}
                          changePercent={row.changePercent}
                          size="sm"
                          className="stock-search-tab__strip"
                        />
                      ) : (
                        <span className="stock-search-tab__quote-pending">
                          {ko.app.stockLookupQuotePending}
                        </span>
                      )}
                    </div>
                  </div>
                  {(msLabel || row.quoteType || row.exchange) && (
                    <div className="stock-search-tab__row-foot">
                      {msLabel ? (
                        <span className="stock-search-tab__chip stock-search-tab__chip--state">
                          {msLabel}
                        </span>
                      ) : null}
                      {row.quoteType ? (
                        <span className="stock-search-tab__chip">
                          {row.quoteType}
                        </span>
                      ) : null}
                      {row.exchange ? (
                        <span className="stock-search-tab__chip stock-search-tab__chip--muted">
                          {row.exchange}
                        </span>
                      ) : null}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
