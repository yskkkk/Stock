import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelBithumbOpenOrder,
  fetchBithumbOpenOrders,
  type BithumbOpenOrder,
  type BithumbOpenOrdersResponse,
} from "../api";
import { formatPercent, formatPrice, formatUpdatedAt } from "../lib/format";
import { ko } from "../i18n/ko";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";

const POLL_MS = 8_000;

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

function sideLabel(side: string): string {
  return side === "sell" ? ko.app.liveTradePfOrderSideSell : ko.app.liveTradePfOrderSideBuy;
}

function ordTypeLabel(ordType: string, side: string): string {
  const t = ordType.trim().toLowerCase();
  if (t === "price" && side === "buy") return "시장가(원)";
  if (t === "market") return "시장가";
  if (t === "limit") return "지정가";
  return ordType || "—";
}

function stateLabel(state: string): string {
  if (state === "watch") return "예약";
  if (state === "wait") return "대기";
  return state;
}

function orderAmountLabel(o: BithumbOpenOrder): string {
  if (o.ordType === "price" && o.side === "buy" && o.price != null) {
    return formatPrice(o.price, o.currency);
  }
  if (o.price != null && o.ordType === "limit") {
    return formatPrice(o.price, o.currency);
  }
  if (o.volume != null) return `${o.volume}개`;
  return "—";
}

export default function LiveTradeOpenOrdersPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [data, setData] = useState<BithumbOpenOrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchBithumbOpenOrders();
      setData(res);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const onCancel = (orderId: string) => {
    if (!window.confirm(ko.app.liveTradePfCancelOrderConfirm)) return;
    setCancelId(orderId);
    setErr(null);
    void cancelBithumbOpenOrder(orderId)
      .then((res) => {
        if (!mountedRef.current) return;
        setData(res);
        onChanged?.();
      })
      .catch((e) => { if (mountedRef.current) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mountedRef.current) setCancelId(null); });
  };

  if (loading && !data) {
    return <p className="live-portfolio__muted">{ko.app.liveTradePfLoading}</p>;
  }

  if (err && !data) {
    return (
      <p className="live-portfolio__banner live-portfolio__banner--err" role="alert">
        {err}
      </p>
    );
  }

  if (data && !data.ready) {
    return (
      <p className="live-portfolio__muted" role="status">
        {data.messageKo ?? ko.app.liveTradePfOpenOrdersNoApi}
      </p>
    );
  }

  if (!data) {
    return (
      <p className="live-portfolio__muted">{ko.app.liveTradePfOpenOrdersNoApi}</p>
    );
  }

  return (
    <>
      <p className="live-portfolio__exchange-note">{ko.app.liveTradePfOpenOrdersNote}</p>
      {data.fetchError ? (
        <p className="live-portfolio__banner live-portfolio__banner--err" role="alert">
          {data.fetchError}
        </p>
      ) : null}
      {err ? (
        <p className="live-portfolio__banner live-portfolio__banner--err" role="alert">
          {err}
        </p>
      ) : null}
      {data.orders.length === 0 ? (
        <p className="live-portfolio__muted">{ko.app.liveTradePfOpenOrdersEmpty}</p>
      ) : (
        <div className="live-portfolio__table-wrap">
          <table className="live-portfolio__table live-portfolio__table--dense live-portfolio__table--open-orders">
            <colgroup>
              <col className="live-portfolio__col live-portfolio__col--ts" />
              <col className="live-portfolio__col live-portfolio__col--side" />
              <col className="live-portfolio__col live-portfolio__col--sym" />
              <col className="live-portfolio__col live-portfolio__col--price" />
              <col className="live-portfolio__col live-portfolio__col--qty" />
              <col className="live-portfolio__col live-portfolio__col--price" />
              <col className="live-portfolio__col live-portfolio__col--pct" />
              <col className="live-portfolio__col live-portfolio__col--act" />
            </colgroup>
            <thead>
              <tr>
                <th>{ko.app.liveTradePfColTime}</th>
                <th>{ko.app.liveTradePfColSide}</th>
                <th>{ko.app.liveTradePfColSymbol}</th>
                <th>{ko.app.liveTradePfColOrderType}</th>
                <th>{ko.app.liveTradePfColRemaining}</th>
                <th>{ko.app.liveTradePfColCurrent}</th>
                <th>24h</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => {
                const up = (o.changePercent ?? 0) >= 0;
                const busy = cancelId === o.orderId;
                return (
                  <tr key={o.orderId} className="live-portfolio__row">
                    <td className="live-portfolio__ts">{formatTs(o.createdAtMs)}</td>
                    <td>
                      <span
                        className={
                          o.side === "sell"
                            ? "live-portfolio__side live-portfolio__side--sell"
                            : "live-portfolio__side live-portfolio__side--buy"
                        }
                      >
                        {sideLabel(o.side)}
                      </span>
                      <span className="live-portfolio__sim">{stateLabel(o.state)}</span>
                    </td>
                    <td>
                      <LiveTradeSymbolCell
                        symbol={o.symbol}
                        name={o.name}
                        market="crypto"
                      />
                    </td>
                    <td className="live-portfolio__num">{ordTypeLabel(o.ordType, o.side)}</td>
                    <td className="live-portfolio__num">
                      {orderAmountLabel(o)}
                      {o.remainingVolume != null && o.ordType !== "price" ? (
                        <span className="live-portfolio__nm">
                          {o.remainingVolume}
                        </span>
                      ) : null}
                    </td>
                    <td className="live-portfolio__num live-portfolio__num--price">
                      {o.currentPrice != null ? (
                        formatPrice(o.currentPrice, o.currency)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={
                        o.changePercent == null
                          ? "live-portfolio__num"
                          : up
                            ? "live-portfolio__num live-portfolio__num--up"
                            : "live-portfolio__num live-portfolio__num--down"
                      }
                    >
                      {o.changePercent != null ? formatPercent(o.changePercent) : "—"}
                    </td>
                    <td className="live-portfolio__actions-cell">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm live-portfolio__sell-btn"
                        disabled={busy}
                        onClick={() => onCancel(o.orderId)}
                      >
                        {busy
                          ? ko.app.liveTradePfCancelOrderBusy
                          : ko.app.liveTradePfCancelOrder}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.updatedAtMs ? (
        <p className="live-portfolio__updated">
          {formatUpdatedAt(data.updatedAtMs)} {ko.app.liveTradePfUpdated}
        </p>
      ) : null}
    </>
  );
}
