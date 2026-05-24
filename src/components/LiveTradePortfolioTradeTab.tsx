import { useEffect, useMemo, useRef, useState } from "react";
import {
  simulateLiveTradeBuy,
  simulateLiveTradeSell,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
} from "../api";
import { useBithumbCryptoQuotesPoll } from "../hooks/useBithumbCryptoQuotesPoll";
import { formatLiveTradeQuantity, formatPercent, formatPrice } from "../lib/format";
import { ko } from "../i18n/ko";
import type { QuoteResponse } from "../types";
import CryptoCoinIcon from "./CryptoCoinIcon";
import LiveTradeSimPanel from "./LiveTradeSimPanel";

function formatTs(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function holdingRowKey(row: LiveTradeHolding): string {
  return `${row.programId}:${row.market}:${row.symbol}`;
}

function parseTradeNumber(raw: string): number | undefined {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function resolveDisplayQuote(
  row: LiveTradeHolding,
  bithumbQuote: QuoteResponse | undefined,
): { price: number | null; changePercent?: number; currency: string } {
  const live = bithumbQuote?.price;
  if (live != null && Number.isFinite(live) && live > 0) {
    return {
      price: live,
      changePercent: bithumbQuote?.changePercent,
      currency: bithumbQuote?.currency ?? row.currency ?? "KRW",
    };
  }
  if (row.currentPrice != null && Number.isFinite(row.currentPrice)) {
    return {
      price: row.currentPrice,
      changePercent: row.changePct ?? undefined,
      currency: row.currency ?? "KRW",
    };
  }
  return { price: null, currency: row.currency ?? "KRW" };
}

function HoldingSellRow({
  row,
  busy,
  expanded,
  portfolioProgramId,
  bithumbQuote,
  onToggle,
  onSold,
  onBought,
}: {
  row: LiveTradeHolding;
  busy: boolean;
  expanded: boolean;
  portfolioProgramId: string;
  bithumbQuote?: QuoteResponse;
  onToggle: () => void;
  onSold: (snap: LiveTradePortfolioResponse) => void;
  onBought: () => void;
}) {
  const [sellQty, setSellQty] = useState(() => String(row.quantity));
  const [tradePrice, setTradePrice] = useState(() =>
    row.currentPrice != null ? String(row.currentPrice) : "",
  );
  const priceDirtyRef = useRef(false);
  const [sellErr, setSellErr] = useState<string | null>(null);
  const [sellOk, setSellOk] = useState<string | null>(null);
  const [buyErr, setBuyErr] = useState<string | null>(null);
  const [buyOk, setBuyOk] = useState<string | null>(null);

  const display = resolveDisplayQuote(row, bithumbQuote);
  const isCrypto = row.market === "crypto";

  useEffect(() => {
    setSellQty(String(row.quantity));
  }, [row.quantity]);

  useEffect(() => {
    if (!expanded) {
      priceDirtyRef.current = false;
      return;
    }
    if (priceDirtyRef.current) return;
    if (display.price != null) {
      setTradePrice(String(display.price));
    }
  }, [expanded, display.price]);

  const applyLivePrice = () => {
    if (display.price != null) {
      setTradePrice(String(display.price));
      priceDirtyRef.current = false;
    }
  };

  const tradePriceNum = () => parseTradeNumber(tradePrice);

  const submitBuy = () => {
    const price = tradePriceNum();
    if (!price) {
      setBuyErr(ko.app.liveTradePfPriceRequired);
      return;
    }
    setBuyErr(null);
    setBuyOk(null);
    void simulateLiveTradeBuy({
      programId: row.programId,
      symbol: row.symbol,
      market: row.market,
      name: row.name ?? undefined,
      price,
    })
      .then((res) => {
        setBuyOk(
          ko.app.liveTradeSimFilled
            .replace("{price}", formatPrice(res.quote.price, row.currency))
            .replace("{time}", formatTs(res.quote.atMs)),
        );
        onBought();
      })
      .catch((e) => setBuyErr(e instanceof Error ? e.message : String(e)));
  };

  const submitSell = () => {
    const quantity = Number(sellQty);
    const price = tradePriceNum();
    if (!price) {
      setSellErr(ko.app.liveTradePfPriceRequired);
      return;
    }
    setSellErr(null);
    setSellOk(null);
    void simulateLiveTradeSell({
      programId: row.programId,
      symbol: row.symbol,
      market: row.market,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
      price,
      portfolioProgramId: portfolioProgramId || null,
    })
      .then((res) => {
        setSellOk(
          ko.app.liveTradeSimFilled
            .replace("{price}", formatPrice(res.quote.price, row.currency))
            .replace("{time}", formatTs(res.quote.atMs)),
        );
        onSold(res.portfolio);
      })
      .catch((e) => setSellErr(e instanceof Error ? e.message : String(e)));
  };

  const chg = display.changePercent;
  const chgUp = chg != null && chg >= 0;

  return (
    <li
      className={
        expanded
          ? "live-portfolio__trade-sell-item live-portfolio__trade-sell-item--open"
          : "live-portfolio__trade-sell-item"
      }
    >
      <button
        type="button"
        className="live-portfolio__trade-sell-main"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="live-portfolio__trade-sell-icon" aria-hidden>
          <CryptoCoinIcon symbol={row.symbol} market={row.market} size={24} />
        </span>
        <div className="live-portfolio__trade-sell-sym">
          <span className="live-portfolio__trade-sell-symbol">{row.symbol}</span>
          {row.name ? (
            <span className="live-portfolio__trade-sell-name">{row.name}</span>
          ) : null}
          {!portfolioProgramId && (row.programName ?? row.programId) ? (
            <span className="live-portfolio__trade-sell-prog">
              {row.programName ?? row.programId}
            </span>
          ) : null}
        </div>
        <div className="live-portfolio__trade-sell-meta">
          <span className="live-portfolio__trade-sell-qty">
            {formatLiveTradeQuantity(row.quantity, row.market)}
          </span>
          {display.price != null ? (
            <span
              className={
                isCrypto
                  ? "live-portfolio__trade-sell-px live-portfolio__trade-sell-px--live"
                  : "live-portfolio__trade-sell-px"
              }
            >
              {formatPrice(display.price, display.currency)}
            </span>
          ) : null}
        </div>
        <span className="live-portfolio__trade-sell-chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="live-portfolio__trade-sell-body">
          {display.price != null ? (
            <div className="live-portfolio__trade-quote-strip" aria-live="polite">
              <div className="live-portfolio__trade-quote-main">
                <span className="live-portfolio__trade-live-label">
                  {isCrypto ? ko.app.liveTradePfLiveQuote : ko.app.liveTradePfColPrice}
                </span>
                <span className="live-portfolio__trade-live-price">
                  {formatPrice(display.price, display.currency)}
                </span>
                {chg != null ? (
                  <span
                    className={
                      chgUp
                        ? "live-portfolio__trade-live-chg live-portfolio__trade-live-chg--up"
                        : "live-portfolio__trade-live-chg live-portfolio__trade-live-chg--down"
                    }
                  >
                    {formatPercent(chg)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="live-portfolio__trade-quote-apply"
                onClick={applyLivePrice}
              >
                {ko.app.liveTradePfUseLivePrice}
              </button>
            </div>
          ) : null}

          <div className="live-portfolio__trade-fields">
            <label className="live-portfolio__trade-field">
              <span className="live-sim__label">{ko.app.liveTradePfColPrice}</span>
              <input
                type="number"
                className="input live-sim__search-input live-portfolio__trade-input"
                min={0}
                step="any"
                inputMode="decimal"
                value={tradePrice}
                onChange={(e) => {
                  priceDirtyRef.current = true;
                  setTradePrice(e.target.value);
                }}
              />
            </label>
            <label className="live-portfolio__trade-field">
              <span className="live-sim__label">{ko.app.liveTradePfColQty}</span>
              <input
                type="number"
                className="input live-sim__search-input live-portfolio__trade-input"
                min={0}
                max={row.quantity}
                step="any"
                inputMode="decimal"
                value={sellQty}
                onChange={(e) => setSellQty(e.target.value)}
              />
            </label>
          </div>

          <div className="live-portfolio__trade-btns">
            <button
              type="button"
              className="live-portfolio__trade-btn live-portfolio__trade-btn--buy"
              disabled={busy}
              onClick={submitBuy}
            >
              {ko.app.liveTradeSimBuy}
            </button>
            <button
              type="button"
              className="live-portfolio__trade-btn live-portfolio__trade-btn--sell"
              disabled={busy}
              onClick={submitSell}
            >
              {ko.app.liveTradeSimSell}
            </button>
          </div>

          {buyErr ? (
            <p className="live-portfolio__sell-err" role="alert">
              {buyErr}
            </p>
          ) : null}
          {buyOk ? (
            <p className="live-portfolio__sell-ok" role="status">
              {buyOk}
            </p>
          ) : null}
          {sellErr ? (
            <p className="live-portfolio__sell-err" role="alert">
              {sellErr}
            </p>
          ) : null}
          {sellOk ? (
            <p className="live-portfolio__sell-ok" role="status">
              {sellOk}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function LiveTradePortfolioTradeTab({
  programs,
  holdings,
  portfolioProgramId,
  busy,
  onTraded,
}: {
  programs: LiveTradeProgram[];
  holdings: LiveTradeHolding[];
  portfolioProgramId: string;
  busy: boolean;
  onTraded: (snap?: LiveTradePortfolioResponse) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showBuySearch, setShowBuySearch] = useState(false);

  const sellHoldings = useMemo(() => {
    const list = portfolioProgramId
      ? holdings.filter((h) => h.programId === portfolioProgramId)
      : holdings;
    return [...list].sort((a, b) => a.symbol.localeCompare(b.symbol, "ko"));
  }, [holdings, portfolioProgramId]);

  const cryptoSymbols = useMemo(
    () =>
      sellHoldings
        .filter((h) => h.market === "crypto")
        .map((h) => h.symbol),
    [sellHoldings],
  );

  const bithumbQuotes = useBithumbCryptoQuotesPoll(cryptoSymbols, cryptoSymbols.length > 0);

  const toggleHolding = (key: string) => {
    setShowBuySearch(false);
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  return (
    <div className="live-portfolio__trade-tab">
      {showBuySearch ? (
        <div className="live-portfolio__trade-buy-wrap">
          <div className="live-portfolio__trade-buy-head">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowBuySearch(false)}
            >
              {ko.app.liveTradePfTradeCollapse}
            </button>
          </div>
          <LiveTradeSimPanel
            embedded
            programs={programs}
            defaultProgramId={portfolioProgramId || undefined}
            onTraded={() => onTraded()}
          />
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm live-portfolio__trade-buy-toggle"
          onClick={() => {
            setExpandedKey(null);
            setShowBuySearch(true);
          }}
        >
          {ko.app.liveTradePfBuyOtherSearch}
        </button>
      )}

      <h5 className="live-sim-run__sub">{ko.app.liveTradePfTabSellSection}</h5>
      {sellHoldings.length === 0 ? (
        <p className="live-sim-run__muted">{ko.app.liveTradePfNoHoldings}</p>
      ) : (
        <ul className="live-portfolio__trade-sell-list">
          {sellHoldings.map((h) => {
            const key = holdingRowKey(h);
            return (
              <HoldingSellRow
                key={key}
                row={h}
                busy={busy}
                expanded={expandedKey === key}
                portfolioProgramId={portfolioProgramId}
                bithumbQuote={
                  h.market === "crypto" ? bithumbQuotes[h.symbol.toUpperCase()] : undefined
                }
                onToggle={() => toggleHolding(key)}
                onSold={onTraded}
                onBought={() => onTraded()}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
