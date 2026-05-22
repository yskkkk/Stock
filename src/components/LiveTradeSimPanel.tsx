import { useCallback, useEffect, useMemo, useState } from "react";
import { useSymbolLiveQuotes } from "../hooks/useSymbolLiveQuotes";
import { mergeQuotesIntoStockSearchRows } from "../lib/stockSearchLiveQuotes";
import {
  fetchStockSearch,
  simulateLiveTradeBuy,
  type LiveTradeProgram,
  type LiveTradeSimQuote,
} from "../api";
import type { StockSearchQuoteRow } from "../types";
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
  const [market, setMarket] = useState<"kr" | "us">("kr");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StockSearchQuoteRow[]>([]);
  const [selected, setSelected] = useState<StockSearchQuoteRow | null>(null);
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
        .then((res) => setHits(res.quotes.slice(0, 8)))
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

  const displayHits = useMemo(
    () => mergeQuotesIntoStockSearchRows(hits, liveQuotes),
    [hits, liveQuotes],
  );

  const displaySelected = useMemo(() => {
    if (!selected) return null;
    const [one] = mergeQuotesIntoStockSearchRows([selected], liveQuotes);
    return one ?? selected;
  }, [selected, liveQuotes]);

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
        const cur = selected.market === "kr" ? "KRW" : "USD";
        setMsg(fillLabel(res.quote, cur));
        onTraded();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [programId, selected, onTraded]);

  if (!programs.length) return null;

  return (
    <section className="live-sim card" aria-label={ko.app.liveTradeSimTitle}>
      <h3 className="live-trading-tab__section-title">{ko.app.liveTradeSimTitle}</h3>
      <p className="live-sim__note">{ko.app.liveTradeSimNote}</p>

      <div className="live-sim__row">
        <label className="live-sim__field">
          <span>{ko.app.liveTradePfProgramFilter}</span>
          <select
            className="input"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
          >
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="live-sim__markets" role="group" aria-label={ko.app.liveTradeFieldMarkets}>
          <button
            type="button"
            className={market === "kr" ? "btn btn--secondary btn--sm active" : "btn btn--secondary btn--sm"}
            onClick={() => {
              setMarket("kr");
              setSelected(null);
            }}
          >
            {ko.app.liveTradeMarketKr}
          </button>
          <button
            type="button"
            className={market === "us" ? "btn btn--secondary btn--sm active" : "btn btn--secondary btn--sm"}
            onClick={() => {
              setMarket("us");
              setSelected(null);
            }}
          >
            {ko.app.liveTradeMarketUs}
          </button>
        </div>
      </div>

      <label className="live-sim__field">
        <span>{ko.app.liveTradeSimSymbol}</span>
        <input
          type="search"
          className="input"
          value={q}
          placeholder={ko.app.liveTradeSimSymbolPh}
          onChange={(e) => {
            setQ(e.target.value);
            setSelected(null);
          }}
        />
      </label>

      {displayHits.length > 0 && !selected ? (
        <ul className="live-sim__hits">
          {displayHits.map((h) => (
            <li key={h.symbol}>
              <button
                type="button"
                className="live-sim__hit"
                onClick={() => {
                  setSelected(h);
                  setQ(h.symbol);
                  setHits([]);
                }}
              >
                <span className="live-sim__hit-sym">{h.symbol}</span>
                <span className="live-sim__hit-name">{h.nameKo ?? h.name}</span>
                {h.price != null ? (
                  <span className="live-sim__hit-price">
                    {formatPrice(h.price, h.currency ?? (h.market === "kr" ? "KRW" : "USD"))}
                    {h.changePercent != null ? ` · ${formatPercent(h.changePercent)}` : ""}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {displaySelected ? (
        <p className="live-sim__picked">
          {displaySelected.symbol} · {displaySelected.nameKo ?? displaySelected.name}
          {displaySelected.price != null ? (
            <>
              {" "}
              ·{" "}
              {formatPrice(
                displaySelected.price,
                displaySelected.currency ??
                  (displaySelected.market === "kr" ? "KRW" : "USD"),
              )}
              {displaySelected.changePercent != null
                ? ` · ${formatPercent(displaySelected.changePercent)}`
                : ""}
            </>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setSelected(null);
              setQ("");
            }}
          >
            {ko.app.liveTradeCancelEdit}
          </button>
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !displaySelected || !programId}
        onClick={onBuy}
      >
        {ko.app.liveTradeSimBuy}
      </button>

      {msg ? (
        <p className="live-sim__ok" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="live-sim__err" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}
