import { useMemo, useState } from "react";
import {
  simulateLiveTradeSell,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
} from "../api";
import { formatLiveTradeQuantity, formatPrice } from "../lib/format";
import { ko } from "../i18n/ko";
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

function HoldingSellRow({
  row,
  busy,
  portfolioProgramId,
  onSold,
}: {
  row: LiveTradeHolding;
  busy: boolean;
  portfolioProgramId: string;
  onSold: (snap: LiveTradePortfolioResponse) => void;
}) {
  const [sellQty, setSellQty] = useState(() => String(row.quantity));
  const [sellErr, setSellErr] = useState<string | null>(null);
  const [sellOk, setSellOk] = useState<string | null>(null);

  const submitSell = () => {
    const quantity = Number(sellQty);
    setSellErr(null);
    setSellOk(null);
    void simulateLiveTradeSell({
      programId: row.programId,
      symbol: row.symbol,
      market: row.market,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
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

  return (
    <li className="live-portfolio__trade-sell-item">
      <div className="live-portfolio__trade-sell-main">
        <CryptoCoinIcon symbol={row.symbol} market={row.market} size={20} />
        <div className="live-portfolio__trade-sell-sym">
          <span className="live-sim-run__sym">{row.symbol}</span>
          {row.name ? <span className="live-sim-run__name">{row.name}</span> : null}
          {!portfolioProgramId && (row.programName ?? row.programId) ? (
            <span className="live-sim-run__name">{row.programName ?? row.programId}</span>
          ) : null}
        </div>
        <span className="live-portfolio__trade-sell-qty">
          {formatLiveTradeQuantity(row.quantity, row.market)}
        </span>
        {row.currentPrice != null ? (
          <span className="live-portfolio__trade-sell-px">
            {formatPrice(row.currentPrice, row.currency)}
          </span>
        ) : null}
      </div>
      <div className="live-portfolio__trade-sell-form">
        <label className="live-portfolio__trade-sell-qty-label">
          <span>{ko.app.liveTradePfColQty}</span>
          <input
            type="number"
            className="input"
            min={0}
            max={row.quantity}
            step="any"
            value={sellQty}
            onChange={(e) => setSellQty(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={submitSell}
        >
          {ko.app.liveTradeSimSell}
        </button>
      </div>
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
  const sellHoldings = useMemo(() => {
    const list = portfolioProgramId
      ? holdings.filter((h) => h.programId === portfolioProgramId)
      : holdings;
    return [...list].sort((a, b) => a.symbol.localeCompare(b.symbol, "ko"));
  }, [holdings, portfolioProgramId]);

  return (
    <div className="live-portfolio__trade-tab">
      <LiveTradeSimPanel
        embedded
        programs={programs}
        defaultProgramId={portfolioProgramId || undefined}
        onTraded={() => onTraded()}
      />

      <h5 className="live-sim-run__sub">{ko.app.liveTradePfTabSellSection}</h5>
      {sellHoldings.length === 0 ? (
        <p className="live-sim-run__muted">{ko.app.liveTradePfNoHoldings}</p>
      ) : (
        <ul className="live-portfolio__trade-sell-list">
          {sellHoldings.map((h) => (
            <HoldingSellRow
              key={`${h.programId}:${h.market}:${h.symbol}`}
              row={h}
              busy={busy}
              portfolioProgramId={portfolioProgramId}
              onSold={onTraded}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
