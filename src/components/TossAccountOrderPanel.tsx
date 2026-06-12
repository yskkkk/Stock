import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  fetchLiveTradingMinuteQuotes,
  fetchTossSellableQuantity,
  placeTossOrder,
  type TossTestHolding,
} from "../api";
import { formatPrice } from "../lib/format";
import {
  formatLimitPriceSeed,
  limitPriceDeviationPct,
  parseLimitPriceInput,
} from "../lib/tossOrderLimitPrice";
import { ko } from "../i18n/ko";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";

type OrderDraft = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  side: "buy" | "sell";
  quantity?: number;
  currentPrice?: number | null;
};

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

function resetOrderFormState(setters: {
  setDraft: (v: OrderDraft | null) => void;
  setAmount: (v: string) => void;
  setQuantity: (v: string) => void;
  setPrice: (v: string) => void;
  setOrderType: (v: "market" | "limit") => void;
  priceTouchedRef: { current: boolean };
}) {
  setters.setDraft(null);
  setters.setAmount("");
  setters.setQuantity("");
  setters.setPrice("");
  setters.setOrderType("market");
  setters.priceTouchedRef.current = false;
}

export type TossAccountOrderPanelHandle = {
  openSell: (holding: TossTestHolding) => void;
};

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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const mountedRef = useRef(true);
  const priceTouchedRef = useRef(false);
  const simulated = !liveOrdersEnabled || !serverLiveOrdersEnabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const seedLimitPriceFromQuote = useCallback(async (nextDraft: OrderDraft) => {
    if (priceTouchedRef.current) return;
    const cp = await resolveDraftCurrentPrice(nextDraft);
    if (!mountedRef.current || cp == null) return;
    setPrice(formatLimitPriceSeed(cp, nextDraft.market));
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
    priceTouchedRef.current = false;
    setDraft({
      symbol: holding.symbol,
      name: holding.name,
      market,
      side: "sell",
      quantity: holding.quantity,
      currentPrice,
    });
    setOrderType("limit");
    setAmount("");
    setQuantity(String(holding.quantity));
    setPrice(
      currentPrice != null ? formatLimitPriceSeed(currentPrice, market) : "",
    );
    setMsg(null);
    setErr(null);
    try {
      const res = await fetchTossSellableQuantity(holding.symbol, market);
      if (res.quantity > 0) setQuantity(String(res.quantity));
    } catch {
      /* keep holding qty */
    }
    if (currentPrice == null) {
      void seedLimitPriceFromQuote({
        symbol: holding.symbol,
        name: holding.name,
        market,
        side: "sell",
        quantity: holding.quantity,
      });
    }
  }, [seedLimitPriceFromQuote]);

  useImperativeHandle(ref, () => ({ openSell: openSellDraft }), [openSellDraft]);

  const selectOrderType = useCallback(
    (next: "market" | "limit") => {
      setOrderType(next);
      if (next === "limit" && draft && !priceTouchedRef.current && !price.trim()) {
        void seedLimitPriceFromQuote(draft);
      }
    },
    [draft, price, seedLimitPriceFromQuote],
  );

  const closeDraft = useCallback(() => {
    resetOrderFormState({
      setDraft,
      setAmount,
      setQuantity,
      setPrice,
      setOrderType,
      priceTouchedRef,
    });
    setErr(null);
  }, []);

  const submitOrder = async () => {
    if (!draft) return;
    const symbol = draft.symbol.trim();
    if (!symbol) {
      setErr("종목을 입력하세요.");
      return;
    }

    let limitPrice: number | null = null;
    if (orderType === "limit") {
      limitPrice = parseLimitPriceInput(price);
      if (limitPrice == null || limitPrice <= 0) {
        setErr(ko.app.liveTradeTossOrderErrLimitPrice);
        return;
      }
    }

    if (draft.side === "buy") {
      const buyAmount = Number(amount);
      if (!Number.isFinite(buyAmount) || buyAmount <= 0) {
        setErr(ko.app.liveTradeTossOrderErrAmount);
        return;
      }
    } else {
      const sellQty = Number(quantity);
      if (!Number.isFinite(sellQty) || sellQty <= 0) {
        setErr(ko.app.liveTradeTossOrderErrQty);
        return;
      }
    }

    const currentPx =
      draft.currentPrice != null && draft.currentPrice > 0
        ? draft.currentPrice
        : await resolveDraftCurrentPrice(draft);
    if (currentPx != null && mountedRef.current) {
      setDraft((d) => (d ? { ...d, currentPrice: currentPx } : d));
    }

    if (orderType === "limit" && limitPrice != null && currentPx != null && currentPx > 0) {
      const pct = limitPriceDeviationPct(limitPrice, currentPx);
      if (pct != null && pct >= 5) {
        const curLabel = formatPrice(currentPx, draft.market === "us" ? "USD" : "KRW");
        const limitLabel = formatPrice(limitPrice, draft.market === "us" ? "USD" : "KRW");
        const farMsg = ko.app.liveTradeTossOrderConfirmFarPrice
          .replace("{price}", limitLabel)
          .replace("{current}", curLabel)
          .replace("{pct}", pct.toFixed(1));
        if (!window.confirm(farMsg)) return;
      }
    }

    const limitLabel =
      limitPrice != null
        ? formatPrice(limitPrice, draft.market === "us" ? "USD" : "KRW")
        : "—";

    let confirmMsg = "";
    if (draft.side === "buy") {
      confirmMsg =
        orderType === "limit"
          ? ko.app.liveTradeTossOrderConfirmLimitBuy
              .replace("{price}", limitLabel)
              .replace("{amount}", amount.trim() || "—")
          : ko.app.liveTradeTossOrderConfirmBuy;
    } else {
      confirmMsg =
        orderType === "limit"
          ? ko.app.liveTradeTossOrderConfirmLimitSell
              .replace("{price}", limitLabel)
              .replace("{qty}", quantity.trim() || "—")
          : ko.app.liveTradeTossOrderConfirmSell;
    }
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
              ...(orderType === "limit" && limitPrice != null
                ? { price: limitPrice }
                : {}),
            }
          : {
              symbol,
              market: draft.market,
              side: "sell" as const,
              orderType,
              quantity: Number(quantity),
              ...(orderType === "limit" && limitPrice != null
                ? { price: limitPrice }
                : {}),
            };
      const res = await placeTossOrder(body);
      if (!mountedRef.current) return;
      if (res.simulated) {
        setMsg(res.messageKo ?? ko.app.liveTradeTossOrderSimBanner);
      } else {
        setMsg(res.messageKo ?? ko.app.liveTradeTossOrderOk);
      }
      resetOrderFormState({
        setDraft,
        setAmount,
        setQuantity,
        setPrice,
        setOrderType,
        priceTouchedRef,
      });
      onChanged?.();
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  if (!draft && !msg && !err) return null;

  const rootClass = [
    "toss-order-panel",
    compact ? "toss-order-panel--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={rootClass} aria-label={ko.app.liveTradeTossOrderTitle}>
      {simulated ? (
        <p className="toss-order-panel__sim" role="status">
          {ko.app.liveTradeTossOrderSimBanner}
        </p>
      ) : null}
      {draft ? (
        <div className="toss-order-panel__form">
          <div className="toss-order-panel__form-head">
            <strong>{sideLabel(draft.side)}</strong>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={closeDraft}
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
              {draft.currentPrice != null && Number.isFinite(draft.currentPrice) ? (
                <p className="toss-order-panel__current">
                  {ko.app.liveTradePfColCurrent}{" "}
                  {formatPrice(
                    draft.currentPrice,
                    draft.market === "us" ? "USD" : "KRW",
                  )}
                </p>
              ) : null}
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
                onChange={(e) => {
                  priceTouchedRef.current = true;
                  setPrice(e.target.value);
                }}
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
    </section>
  );
});

export default TossAccountOrderPanel;
