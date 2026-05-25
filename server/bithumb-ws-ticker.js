/**
 * 빗썸 API 2.0 Public WebSocket — 현재가(ticker) 실시간 캐시
 * @see https://apidocs.bithumb.com/reference/현재가-ticker
 */
import { usdtSymbolToBithumbBase } from "./bithumb-krw.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const WS_URL =
  String(process.env.BITHUMB_WS_URL ?? "").trim() ||
  "wss://ws-api.bithumb.com/websocket/v1";

const PING_MS = (() => {
  const n = Number(process.env.BITHUMB_WS_PING_MS ?? 30_000);
  return Number.isFinite(n) && n >= 10_000 ? Math.min(n, 90_000) : 30_000;
})();

const RECONNECT_MS = (() => {
  const n = Number(process.env.BITHUMB_WS_RECONNECT_MS ?? 4_000);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 60_000) : 4_000;
})();

/** @type {Map<string, { price: number; quotedAtMs: number; code: string }>} */
const byYahooSymbol = new Map();

/** @type {Set<string>} */
let wantedKrwCodes = new Set();

/** @type {((yahooSymbol: string, row: { price: number; quotedAtMs: number }) => void) | null} */
let onPriceUpdate = null;

/** @type {WebSocket | null} */
let ws = null;
let reconnectTimer = null;
let pingTimer = null;
let started = false;
let connecting = false;

/**
 * @param {string} krwCode e.g. KRW-BTC
 */
export function krwCodeToYahooSymbol(krwCode) {
  const code = String(krwCode ?? "").trim().toUpperCase();
  const m = /^KRW-([A-Z0-9]+)$/.exec(code);
  if (!m) return null;
  return `${m[1]}-USDT`;
}

/**
 * @param {string} yahooSymbol e.g. BTC-USDT
 */
export function yahooSymbolToKrwCode(yahooSymbol) {
  const base = usdtSymbolToBithumbBase(yahooSymbol);
  return base ? `KRW-${base}` : null;
}

/**
 * @param {string} yahooSymbol
 */
export function getBithumbWsTickerQuote(yahooSymbol) {
  const sym = String(yahooSymbol ?? "").trim().toUpperCase();
  return byYahooSymbol.get(sym) ?? null;
}

/**
 * @param {string[]} yahooSymbols
 */
export function setBithumbWsTickerWanted(yahooSymbols) {
  const next = new Set();
  for (const sym of yahooSymbols) {
    const code = yahooSymbolToKrwCode(sym);
    if (code) next.add(code);
  }
  const prevKey = [...wantedKrwCodes].sort().join(",");
  const nextKey = [...next].sort().join(",");
  wantedKrwCodes = next;
  if (next.size === 0) {
    closeSocket();
    return;
  }
  if (!started) return;
  if (prevKey !== nextKey) {
    closeSocket();
    connect();
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connect();
  }
}

/**
 * @param {{ onPriceUpdate?: (yahooSymbol: string, row: { price: number; quotedAtMs: number }) => void }} [opts]
 */
export function startBithumbWsTickerHub(opts = {}) {
  if (process.env.STOCK_BITHUMB_WS_TICKER === "0") return;
  if (typeof WebSocket === "undefined") {
    liveTradeLogWarn("[bithumb-ws] WebSocket unavailable — REST ticker fallback");
    return;
  }
  if (started) {
    if (opts.onPriceUpdate) onPriceUpdate = opts.onPriceUpdate;
    return;
  }
  started = true;
  onPriceUpdate = opts.onPriceUpdate ?? null;
  if (wantedKrwCodes.size > 0) connect();
}

export function stopBithumbWsTickerHub() {
  started = false;
  onPriceUpdate = null;
  closeSocket();
}

function closeSocket() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  connecting = false;
}

function scheduleReconnect() {
  if (!started || wantedKrwCodes.size === 0) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function startPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send("PING");
    } catch {
      /* ignore */
    }
  }, PING_MS);
}

function subscribePayload() {
  const codes = [...wantedKrwCodes];
  return [
    { ticket: `stock-box-${Date.now()}` },
    {
      type: "ticker",
      codes,
      isOnlyRealtime: true,
    },
    { format: "DEFAULT" },
  ];
}

function resubscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (wantedKrwCodes.size === 0) return;
  try {
    ws.send(JSON.stringify(subscribePayload()));
  } catch (e) {
    liveTradeLogWarn(
      "[bithumb-ws] subscribe send failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

function connect() {
  if (!started || wantedKrwCodes.size === 0) return;
  if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  connecting = true;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    connecting = false;
    liveTradeLogWarn(
      "[bithumb-ws] connect failed:",
      e instanceof Error ? e.message : e,
    );
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    connecting = false;
    liveTradeLogInfo("[bithumb-ws] connected", wantedKrwCodes.size, "codes");
    resubscribe();
    startPing();
  });

  ws.addEventListener("message", (ev) => {
    handleMessage(ev.data);
  });

  ws.addEventListener("close", () => {
    connecting = false;
    ws = null;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    connecting = false;
  });
}

/**
 * @param {unknown} raw
 */
function handleMessage(raw) {
  const text = typeof raw === "string" ? raw : "";
  if (!text || text === "PONG") return;
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    return;
  }
  if (!o || typeof o !== "object") return;
  if (o.status === "UP") return;

  const ty = String(o.type ?? o.ty ?? "");
  if (ty !== "ticker") return;

  const code = String(o.code ?? o.cd ?? "").trim().toUpperCase();
  const yahoo = krwCodeToYahooSymbol(code);
  const price = Number(o.trade_price ?? o.tp);
  const quotedAtMs = Number(
    o.timestamp ?? o.trade_timestamp ?? o.tms ?? Date.now(),
  );
  if (!yahoo || !Number.isFinite(price) || price <= 0) return;

  const row = { price, quotedAtMs, code };
  byYahooSymbol.set(yahoo, row);
  onPriceUpdate?.(yahoo, row);
}
