import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  cancelTossOpenOrder,
  fetchLiveTradingMinuteQuotes,
  fetchTossOpenOrders,
  fetchTossSellableQuantity,
  placeTossOrder,
  type TossOpenOrder,
  type TossOpenOrdersResponse,
  type TossTestHolding,
} from "../api";
import { formatPrice, formatUpdatedAt } from "../lib/format";
import { ko } from "../i18n/ko";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";

const POLL_MS = 8_000;
const TOSS_TRADE_URL = "https://www.tossinvest.com/";

type OrderDraft = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  side: "buy" | "sell";
  quantity?: number;
  currentPrice?: number | null;
};

function formatLimitPriceInput(price: number, market: "kr" | "us"): string {
  if (!Number.isFinite(price) || price <= 0) return "";
  if (market === "kr") return String(Math.round(price));
  return price.toFixed(2).replace(/\.?0+$/, "");
}

async function resolveDraftCurrentPrice(draft: OrderDraft): Promise<number | null> {
  const cached = draft.currentPrice;
  if (cached != null && Number.isFinite(cached) && cached > 0) return cached;
  const sym = draft.symbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const res = await fetchLiveTradingMinuteQuotes([sym]);
    const quotes = res.quotes ?? {};
    const direct = quotes[sym];
    if (direct?.price != null && Number.isFinite(direct.price) && direct.price > 0) {
      return direct.price;
    }
    const bare = sym.replace(/\.(KS|KQ)$/i, "");
    const alt = bare !== sym ? quotes[bare] : undefined;
    if (alt?.price != null && Number.isFinite(alt.price) && alt.price > 0) {
      return alt.price;
    }
  } catch {
    /* 시세 없으면 빈칸 유지 */
  }
  return null;
}

export type TossAccountOrderPanelHandle = {
  openSell: (holding: TossTestHolding) => void;
};

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
  return side === "sell"
    ? ko.app.liveTradeTossOrderSideSell
    : ko.app.liveTradeTossOrderSideBuy;
}

const TossAccountOrderPanel = forwardRef<
  TossAccountOrderPanelHandle,
  {
    compact?: boolean;
    liveOrdersEnabled?: boolean;
    serverLiveOrdersEnabled?: boolean;
    onChanged?: () => void;
  }
>(function TossAccountOrderPanel(
  {
    compact = false,
    liveOrdersEnabled = false,
    serverLiveOrdersEnabled = false,
    onChanged,
  },
  ref,
) {
  const [openOrders, setOpenOrders] = useState<TossOpenOrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const mountedRef = useRef(true);

  const simulated = !liveOrdersEnabled || !serverLiveOrdersEnabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadOpenOrders = useCallback(async () => {
    try {
      const res = await fetchTossOpenOrders();
      if (!mountedRef.current) return;
      setOpenOrders(res);
      setErr(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadOpenOrders();
    const id = window.setInterval(() => void loadOpenOrders(), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadOpenOrders]);

  const fillLimitPriceFromQuote = useCallback(async (nextDraft: OrderDraft) => {
    const cp = await resolveDraftCurrentPrice(nextDraft);
    if (!mountedRef.current || cp == null) return;
    setPrice(formatLimitPriceInput(cp, nextDraft.market));
    setDraft((d) => (d ? { ...d, currentPrice: cp } : d));
  }, []);

  const openSellDraft = useCallback(async (holding: TossTestHolding) => {
    const market = holding.market === "us" ? "us" : "kr";
    const currentPrice =
      holding.currentPrice != null &&
      Number.isFinite(holding.currentPrice) &&
      holding.currentPrice > 0
        ? holding.currentPrice
        : null;
    const nextDraft: OrderDraft = {
      symbol: holding.symbol,
      name: holding.name,
      market,
      side: "sell",
      quantity: holding.quantity,
      currentPrice,
    };
    setDraft(nextDraft);
    setOrderType("limit");
    setAmount("");
    setPrice(
      currentPrice != null ? formatLimitPriceInput(currentPrice, market) : "",
    );
    setQuantity(String(holding.quantity));
    setMsg(null);
    setErr(null);
    try {
      const res = await fetchTossSellableQuantity(holding.symbol, market);
      if (res.quantity > 0) setQuantity(String(res.quantity));
    } catch {
      /* keep holding qty */
    }
  }, []);

  useImperativeHandle(ref, () => ({ openSell: openSellDraft }), [openSellDraft]);

  useEffect(() => {
    if (!draft || orderType !== "limit" || price.trim()) return;
    let cancelled = false;
    void (async () => {
      const cp = await resolveDraftCurrentPrice(draft);
      if (cancelled || cp == null) return;
      setPrice(formatLimitPriceInput(cp, draft.market));
      setDraft((d) => (d ? { ...d, currentPrice: cp } : d));
    })();
    return () => {
      cancelled = true;
    };
  }, [draft?.symbol, draft?.market, draft?.side, draft?.currentPrice, orderType, price]);

  const selectOrderType = useCallback(
    (next: "market" | "limit") => {
      setOrderType(next);
      if (next === "limit" && draft && !price.trim()) {
        void fillLimitPriceFromQuote(draft);
      }
    },
    [draft, fillLimitPriceFromQuote, price],
  );

  const openBuyDraft = useCallback(() => {
    setDraft({
      symbol: "",
      name: "",
      market: "kr",
      side: "buy",
    });
    setOrderType("market");
    setAmount("");
    setQuantity("");
    setPrice("");
    setMsg(null);
    setErr(null);
  }, []);

  const submitOrder = async () => {
    if (!draft) return;
    const symbol = draft.symbol.trim();
    if (!symbol) {
      setErr("종목을 입력하세요.");
      return;
    }
    const confirmMsg =
      draft.side === "buy"
        ? ko.app.liveTradeTossOrderConfirmBuy
        : ko.app.liveTradeTossOrderConfirmSell;
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const body =
        draft.side === "buy"
          ? {
              symbol,
              market: draft.market,
              side: "buy" as const,
              orderType,
              amount: Number(amount),
              ...(orderType === "limit" ? { price: Number(price) } : {}),
            }
          : {
              symbol,
              market: draft.market,
              side: "sell" as const,
              orderType,
              quantity: Number(quantity),
              ...(orderType === "limit" ? { price: Number(price) } : {}),
            };
      const res = await placeTossOrder(body);
      if (!mountedRef.current) return;
      setMsg(ko.app.liveTradeTossOrderOk);
      if (res.openOrders) setOpenOrders(res.openOrders);
      setDraft(null);
      onChanged?.();
      void loadOpenOrders();
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const onCancel = (orderId: string) => {
    if (!window.confirm(ko.app.liveTradePfCancelOrderConfirm)) return;
    setCancelId(orderId);
    setErr(null);
    void cancelTossOpenOrder(orderId)
      .then((res) => {
        if (!mountedRef.current) return;
        setOpenOrders(res);
        onChanged?.();
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (mountedRef.current) setCancelId(null);
      });
  };

  const rootClass = [
    "toss-order-panel",
    compact ? "toss-order-panel--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={rootClass} aria-label={ko.app.liveTradeTossOrderTitle}>
      <div className="toss-order-panel__toolbar">
        <button
          type="button"
          className="btn btn--secondary btn--sm toss-order-panel__btn"
          onClick={openBuyDraft}
        >
          {ko.app.liveTradeTossOrderBuy}
        </button>
        <a
          className="btn btn--ghost btn--sm toss-order-panel__link"
          href={TOSS_TRADE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ko.app.liveTradeTossOpenInApp}
        </a>
      </div>

      {draft ? (
        <div className="toss-order-panel__form">
          <div className="toss-order-panel__form-head">
            <strong>{sideLabel(draft.side)}</strong>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setDraft(null)}
            >
              {ko.app.liveTradeCancelEdit}
            </button>
          </div>
          {draft.side === "buy" ? (
            <>
              <label className="toss-order-panel__field">
                <span>{ko.app.liveTradeTossOrderSymbol}</span>
                <input
                  className="input toss-order-panel__input"
                  value={draft.symbol}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, symbol: e.target.value } : d))
                  }
                  placeholder="005930.KS / AAPL"
                  spellCheck={false}
                />
              </label>
              <label className="toss-order-panel__field">
                <span>{ko.app.liveTradeFieldMarkets}</span>
                <select
                  className="input toss-order-panel__input"
                  value={draft.market}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? { ...d, market: e.target.value === "us" ? "us" : "kr" }
                        : d,
                    )
                  }
                >
                  <option value="kr">국내</option>
                  <option value="us">미국</option>
                </select>
              </label>
            </>
          ) : (
            <div className="toss-order-panel__symbol">
              <LiveTradeSymbolCell
                symbol={draft.symbol}
                name={draft.name}
                market={draft.market}
              />
            </div>
          )}
          <div className="toss-order-panel__type">
            <button
              type="button"
              className={
                orderType === "market"
                  ? "toss-order-panel__type-btn active"
                  : "toss-order-panel__type-btn"
              }
              onClick={() => selectOrderType("market")}
            >
              {ko.app.liveTradeTossOrderMarket}
            </button>
            <button
              type="button"
              className={
                orderType === "limit"
                  ? "toss-order-panel__type-btn active"
                  : "toss-order-panel__type-btn"
              }
              onClick={() => selectOrderType("limit")}
            >
              {ko.app.liveTradeTossOrderLimit}
            </button>
          </div>
          {draft.side === "buy" ? (
            <label className="toss-order-panel__field">
              <span>{ko.app.liveTradeTossOrderAmount}</span>
              <input
                className="input toss-order-panel__input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={draft.market === "us" ? "USD" : "KRW"}
              />
            </label>
          ) : (
            <label className="toss-order-panel__field">
              <span>{ko.app.liveTradeTossOrderQty}</span>
              <input
                className="input toss-order-panel__input"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
          )}
          {orderType === "limit" ? (
            <label className="toss-order-panel__field">
              <span>{ko.app.liveTradeTossOrderPrice}</span>
              <input
                className="input toss-order-panel__input"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn--primary btn--sm toss-order-panel__submit"
            disabled={busy}
            onClick={() => void submitOrder()}
          >
            {busy ? ko.app.liveTradeTossOrderBusy : ko.app.liveTradeTossOrderSubmit}
          </button>
        </div>
      ) : null}

      {msg ? (
        <p className="toss-order-panel__msg" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="toss-order-panel__err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="toss-order-panel__open">
        <h4 className="toss-order-panel__open-title">{ko.app.liveTradeTossOpenOrders}</h4>
        {loading && !openOrders ? (
          <p className="toss-order-panel__muted">{ko.app.liveTradePfLoading}</p>
        ) : openOrders && !openOrders.ready ? (
          <p className="toss-order-panel__muted">{openOrders.messageKo}</p>
        ) : openOrders?.fetchError ? (
          <p className="toss-order-panel__err" role="alert">
            {openOrders.fetchError}
          </p>
        ) : !openOrders?.orders.length ? (
          <p className="toss-order-panel__muted">{ko.app.liveTradeTossOpenOrdersEmpty}</p>
        ) : (
          <ul className="toss-order-panel__orders">
            {openOrders.orders.map((o: TossOpenOrder) => (
              <li key={o.orderId} className="toss-order-panel__order">
                <div className="toss-order-panel__order-row">
                  <span className={`toss-order-panel__side toss-order-panel__side--${o.side}`}>
                    {sideLabel(o.side)}
                  </span>
                  <LiveTradeSymbolCell
                    symbol={o.symbol}
                    name={o.name}
                    market={o.market === "us" ? "us" : "kr"}
                  />
                </div>
                <div className="toss-order-panel__order-row">
                  <span className="toss-order-panel__muted">{formatTs(o.createdAtMs)}</span>
                  <span>
                    {o.ordType === "limit" && o.price != null
                      ? formatPrice(o.price, o.currency)
                      : o.amount != null
                        ? formatPrice(o.amount, o.currency)
                        : o.volume != null
                          ? `${o.volume}주`
                          : "—"}
                  </span>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={cancelId === o.orderId || simulated}
                    onClick={() => onCancel(o.orderId)}
                  >
                    {cancelId === o.orderId
                      ? ko.app.liveTradePfCancelOrderBusy
                      : ko.app.liveTradePfCancelOrder}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {openOrders?.updatedAtMs ? (
          <p className="toss-order-panel__updated">
            {formatUpdatedAt(openOrders.updatedAtMs)} {ko.app.liveTradePfUpdated}
          </p>
        ) : null}
      </div>
    </section>
  );
});

export default TossAccountOrderPanel;
