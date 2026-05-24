import { useCallback, useEffect, useMemo, useState } from "react";
import { useSymbolLiveQuotes } from "../hooks/useSymbolLiveQuotes";
import {
  fetchStockSearch,
  simulateLiveTradeBuy,
  type LiveTradeProgram,
  type LiveTradeSimQuote,
} from "../api";
import type { LiveTradeMarket } from "../types";

/** 실거래 시뮬 검색 행 (주식 + 코인) */
export type LiveTradeSearchRow = {
  symbol: string;
  name: string;
  market: LiveTradeMarket;
  nameKo?: string | null;
  price?: number;
  changePercent?: number;
  currency?: string;
};
import { formatPercent, formatPrice } from "../lib/format";
import { ko } from "../i18n/ko";

function formatTs(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function fillLabel(quote: LiveTradeSimQuote, currency: string): string {
  return ko.app.liveTradeSimFilled
    .replace("{price}", formatPrice(quote.price, currency))
    .replace("{time}", formatTs(quote.atMs));
}

function quoteCurrency(row: LiveTradeSearchRow): string {
  if (row.currency) return row.currency;
  if (row.market === "us") return "USD";
  return "KRW";
}

export default function LiveTradeSimPanel({
  programs,
  defaultProgramId,
  onTraded,
}: {
  programs: LiveTradeProgram[];
  defaultProgramId?: string;
  onTraded: () => void;
}) {
  const [programId, setProgramId] = useState(
    () => defaultProgramId ?? programs[0]?.id ?? "",
  );
  const [market, setMarket] = useState<LiveTradeMarket>("kr");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LiveTradeSearchRow[]>([]);
  const [selected, setSelected] = useState<LiveTradeSearchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (defaultProgramId) setProgramId(defaultProgramId);
    else if (!programId && programs[0]) setProgramId(programs[0].id);
  }, [defaultProgramId, programs, programId]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void fetchStockSearch(term, market)
        .then((res) => setHits(res.quotes.slice(0, 8) as LiveTradeSearchRow[]))
        .catch(() => setHits([]));
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, market]);

  const quoteSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const h of hits) s.add(h.symbol);
    if (selected?.symbol) s.add(selected.symbol);
    return [...s];
  }, [hits, selected?.symbol]);

  const liveQuotes = useSymbolLiveQuotes(quoteSymbols, quoteSymbols.length > 0);

  const enrichRow = useCallback(
    (row: LiveTradeSearchRow): LiveTradeSearchRow => {
      const q = liveQuotes[row.symbol];
      if (q?.price == null || !Number.isFinite(q.price)) return row;
      return {
        ...row,
        price: q.price,
        changePercent: q.changePercent ?? row.changePercent,
        currency: q.currency ?? row.currency,
      };
    },
    [liveQuotes],
  );

  const displayHits = useMemo(
    () => hits.map(enrichRow),
    [hits, enrichRow],
  );

  const displaySelected = useMemo(
    () => (selected ? enrichRow(selected) : null),
    [selected, enrichRow],
  );

  const onBuy = useCallback(() => {
    if (!programId) {
      setErr(ko.app.liveTradeSimNoProgram);
      return;
    }
    if (!selected?.symbol) {
      setErr(ko.app.liveTradeSimPickSymbol);
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    void simulateLiveTradeBuy({
      programId,
      symbol: selected.symbol,
      market: selected.market,
      name: selected.nameKo ?? selected.name,
    })
      .then((res) => {
        const cur = quoteCurrency(selected);
        setMsg(fillLabel(res.quote, cur));
        onTraded();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [programId, selected, onTraded]);

  const eligiblePrograms = useMemo(
    () =>
      programs.filter((p) =>
        market === "crypto"
          ? p.markets.crypto
          : market === "us"
            ? p.markets.us
            : p.markets.kr,
      ),
    [programs, market],
  );

  useEffect(() => {
    if (!eligiblePrograms.some((p) => p.id === programId)) {
      setProgramId(eligiblePrograms[0]?.id ?? "");
    }
  }, [eligiblePrograms, programId]);

  if (!programs.length) return null;

  if (!eligiblePrograms.length) return null;

  const selectedCur = displaySelected ? quoteCurrency(displaySelected) : null;
  const selectedChg = displaySelected?.changePercent;
  const selectedChgUp = selectedChg != null && selectedChg >= 0;

  return (
    <section className="live-sim card" aria-label={ko.app.liveTradeSimTitle}>
      <header className="live-sim__head">
        <h3 className="live-trading-tab__section-title live-sim__title">
          {ko.app.liveTradeSimTitle}
        </h3>
        <p className="live-sim__note">{ko.app.liveTradeSimNote}</p>
      </header>

      <div className="live-sim__panel">
        <div className="live-sim__grid">
          <label className="live-sim__field live-sim__field--program">
            <span className="live-sim__label">{ko.app.liveTradePfProgramFilter}</span>
            <select
              className="input live-sim__select"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              {eligiblePrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="live-sim__field live-sim__field--market">
            <span className="live-sim__label">{ko.app.liveTradeFieldMarkets}</span>
            <div
              className="live-sim__segment"
              role="group"
              aria-label={ko.app.liveTradeFieldMarkets}
            >
              <button
                type="button"
                className={
                  market === "kr"
                    ? "live-sim__segment-btn live-sim__segment-btn--on"
                    : "live-sim__segment-btn"
                }
                aria-pressed={market === "kr"}
                onClick={() => {
                  setMarket("kr");
                  setSelected(null);
                }}
              >
                {ko.app.liveTradeMarketKr}
              </button>
              <button
                type="button"
                className={
                  market === "us"
                    ? "live-sim__segment-btn live-sim__segment-btn--on"
                    : "live-sim__segment-btn"
                }
                aria-pressed={market === "us"}
                onClick={() => {
                  setMarket("us");
                  setSelected(null);
                }}
              >
                {ko.app.liveTradeMarketUs}
              </button>
              <button
                type="button"
                className={
                  market === "crypto"
                    ? "live-sim__segment-btn live-sim__segment-btn--on"
                    : "live-sim__segment-btn"
                }
                aria-pressed={market === "crypto"}
                onClick={() => {
                  setMarket("crypto");
                  setSelected(null);
                }}
              >
                {ko.app.liveTradeMarketCrypto}
              </button>
            </div>
          </div>
        </div>

        <label className="live-sim__field live-sim__field--search">
          <span className="live-sim__label">{ko.app.liveTradeSimSymbol}</span>
          <div className="live-sim__search-wrap">
            <input
              type="search"
              className="input live-sim__search-input"
              value={q}
              placeholder={ko.app.liveTradeSimSymbolPh}
              autoComplete="off"
              onChange={(e) => {
                setQ(e.target.value);
                setSelected(null);
              }}
            />
          </div>
        </label>

        {displayHits.length > 0 && !selected ? (
          <ul className="live-sim__hits" role="listbox" aria-label={ko.app.liveTradeSimSymbol}>
            {displayHits.map((h) => {
              const cur = quoteCurrency(h);
              const chg = h.changePercent;
              const chgUp = chg != null && chg >= 0;
              return (
                <li key={h.symbol} role="option">
                  <button
                    type="button"
                    className="live-sim__hit"
                    onClick={() => {
                      setSelected(h);
                      setQ(h.symbol);
                      setHits([]);
                    }}
                  >
                    <span className="live-sim__hit-main">
                      <span className="live-sim__hit-sym">{h.symbol}</span>
                      <span className="live-sim__hit-name">{h.nameKo ?? h.name}</span>
                    </span>
                    {h.price != null ? (
                      <span className="live-sim__hit-quote">
                        <span className="live-sim__hit-price">
                          {formatPrice(h.price, cur)}
                        </span>
                        {chg != null ? (
                          <span
                            className={
                              chgUp
                                ? "live-sim__hit-chg live-sim__hit-chg--up"
                                : "live-sim__hit-chg live-sim__hit-chg--down"
                            }
                          >
                            {formatPercent(chg)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {displaySelected ? (
          <div className="live-sim__selection" aria-live="polite">
            <div className="live-sim__selection-main">
              <span className="live-sim__selection-sym">{displaySelected.symbol}</span>
              <span className="live-sim__selection-name">
                {displaySelected.nameKo ?? displaySelected.name}
              </span>
              {displaySelected.price != null && selectedCur ? (
                <span className="live-sim__selection-quote">
                  <span className="live-sim__selection-price">
                    {formatPrice(displaySelected.price, selectedCur)}
                  </span>
                  {selectedChg != null ? (
                    <span
                      className={
                        selectedChgUp
                          ? "live-sim__selection-chg live-sim__selection-chg--up"
                          : "live-sim__selection-chg live-sim__selection-chg--down"
                      }
                    >
                      {formatPercent(selectedChg)}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="live-sim__selection-clear"
              onClick={() => {
                setSelected(null);
                setQ("");
              }}
            >
              {ko.app.liveTradeCancelEdit}
            </button>
          </div>
        ) : null}

        <div className="live-sim__actions">
          <button
            type="button"
            className="btn btn--primary live-sim__submit"
            disabled={busy || !displaySelected || !programId}
            onClick={onBuy}
          >
            {busy ? ko.app.liveTradeSimBuy + "…" : ko.app.liveTradeSimBuy}
          </button>
        </div>

        {msg ? (
          <p className="live-sim__banner live-sim__banner--ok" role="status">
            {msg}
          </p>
        ) : null}
        {err ? (
          <p className="live-sim__banner live-sim__banner--err" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </section>
  );
}
