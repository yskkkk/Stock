/**
 * 토스 Open API POST /api/v1/orders 요청 본문 (openapi.json OrderCreateRequest)
 */

/**
 * @param {number} price
 * @param {"kr"|"us"} market
 */
export function formatTossOrderPriceValue(price, market) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (market === "us") return p.toFixed(2);
  return String(Math.round(p));
}

/**
 * @param {string | undefined | null} raw
 */
export function sanitizeTossClientOrderId(raw) {
  const id = String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9\-_]/g, "-")
    .slice(0, 36);
  return id || undefined;
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 */
export function tossOrderSymbol(symbol, market) {
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (market === "kr") {
    const digits = raw.replace(/\.(KS|KQ|KO)$/i, "").replace(/\D/g, "");
    return digits.slice(0, 6);
  }
  return raw.replace(/\.(KS|KQ)$/i, "");
}

/**
 * @param {{
 *   symbol: string;
 *   market: "kr"|"us";
 *   side: "buy"|"sell"|"BUY"|"SELL";
 *   orderType: "market"|"limit"|"MARKET"|"LIMIT";
 *   quantity?: number;
 *   amount?: number;
 *   price?: number;
 *   clientOrderId?: string;
 *   timeInForce?: "DAY"|"CLS";
 * }} input
 */
export function buildTossOrderCreateBody(input) {
  const market = input.market === "us" ? "us" : "kr";
  const sideRaw = String(input.side ?? "").trim().toUpperCase();
  const side = sideRaw === "SELL" ? "SELL" : "BUY";
  const orderTypeRaw = String(input.orderType ?? "market").trim().toUpperCase();
  const orderType = orderTypeRaw === "LIMIT" ? "LIMIT" : "MARKET";
  const symbol = tossOrderSymbol(input.symbol, market);
  if (!symbol) {
    throw new Error("종목 코드가 올바르지 않습니다.");
  }

  const clientOrderId = sanitizeTossClientOrderId(input.clientOrderId);

  if (orderType === "MARKET" && side === "BUY" && market === "us") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("매수 금액을 입력하세요.");
    }
    const orderAmount = formatTossOrderPriceValue(amount, "us");
    if (!orderAmount) {
      throw new Error("매수 금액을 입력하세요.");
    }
    return {
      ...(clientOrderId ? { clientOrderId } : {}),
      symbol,
      side,
      orderType,
      orderAmount,
    };
  }

  /** @type {Record<string, unknown>} */
  const body = {
    ...(clientOrderId ? { clientOrderId } : {}),
    symbol,
    side,
    orderType,
  };
  if (input.timeInForce) body.timeInForce = input.timeInForce;

  const qty = Math.floor(Number(input.quantity));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(
      side === "SELL" ? "매도 수량을 입력하세요." : "매수 수량을 계산할 수 없습니다.",
    );
  }
  body.quantity = String(qty);

  if (orderType === "LIMIT") {
    const priceStr = formatTossOrderPriceValue(input.price, market);
    if (!priceStr) {
      throw new Error("지정가를 입력하세요.");
    }
    body.price = priceStr;
  }

  return body;
}

/**
 * @param {unknown} json
 */
export function parseTossOrderIdFromResponse(json) {
  const result =
    json && typeof json === "object" && json.result && typeof json.result === "object"
      ? json.result
      : json && typeof json === "object"
        ? json
        : {};
  return String(result?.orderId ?? result?.id ?? "").trim();
}
