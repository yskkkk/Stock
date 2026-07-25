import type { AppTab, ChartTimeframe, Market, StockPick } from "../types";

const STORAGE_KEY = "stock-mobile-app-session-v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const APP_TABS: readonly AppTab[] = [
  "screener",
  "recommendations",
  "liveTrading",
  "stockLookup",
  "crypto",
  "tradeHistory",
  "boxRange",
  "financials",
  "stockVault",
  "investorFlow",
  "sp500Sector",
  "nasdaqEtf",
  "accountManage",
  "ops",
];

const TIMEFRAMES: readonly ChartTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

/** 새로고침·재진입 시 종목 검색으로 복귀 — 보조 탭은 기본 탭으로 저장하지 않음 */
const EPHEMERAL_MAIN_TABS: ReadonlySet<AppTab> = new Set([
  "sp500Sector",
  "nasdaqEtf",
]);

export function resolvePersistedAppTab(tab: AppTab): AppTab {
  return EPHEMERAL_MAIN_TABS.has(tab) ? "stockLookup" : tab;
}

type SessionPickV1 = {
  symbol: string;
  name: string;
  market: Market;
  score: number;
  signals: string[];
};

export type MobileAppSessionV1 = {
  version: 1;
  savedAt: number;
  appTab: AppTab;
  screenerSelected: SessionPickV1 | null;
  lookupSelected: SessionPickV1 | null;
  timeframe: ChartTimeframe;
  scrollTop: number;
};

function normalizePick(raw: unknown): SessionPickV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<SessionPickV1>;
  const symbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const market = o.market === "kr" || o.market === "us" || o.market === "crypto" ? o.market : null;
  if (!symbol || !name || !market) return null;
  const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : 0;
  const signals = Array.isArray(o.signals)
    ? o.signals.filter((s): s is string => typeof s === "string")
    : [];
  return { symbol, name, market, score, signals };
}

function normalizeTab(raw: unknown): AppTab {
  if (typeof raw === "string" && (APP_TABS as readonly string[]).includes(raw)) {
    return raw as AppTab;
  }
  return "stockLookup";
}

function normalizeTimeframe(raw: unknown): ChartTimeframe {
  if (typeof raw === "string" && (TIMEFRAMES as readonly string[]).includes(raw)) {
    return raw as ChartTimeframe;
  }
  return "1m";
}

export function pickToSessionPick(pick: StockPick | null): SessionPickV1 | null {
  if (!pick) return null;
  return {
    symbol: pick.symbol.trim(),
    name: pick.name.trim() || pick.symbol.trim(),
    market: pick.market,
    score: pick.score,
    signals: Array.isArray(pick.signals) ? pick.signals : [],
  };
}

export function sessionPickToStockPick(pick: SessionPickV1 | null): StockPick | null {
  if (!pick) return null;
  return {
    symbol: pick.symbol,
    name: pick.name,
    market: pick.market,
    score: pick.score,
    signals: pick.signals,
  };
}

export function readMobileAppSession(): MobileAppSessionV1 | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MobileAppSessionV1>;
    if (parsed.version !== 1) return null;
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (!savedAt || Date.now() - savedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      version: 1,
      savedAt,
      appTab: resolvePersistedAppTab(normalizeTab(parsed.appTab)),
      screenerSelected: normalizePick(parsed.screenerSelected),
      lookupSelected: normalizePick(parsed.lookupSelected),
      timeframe: normalizeTimeframe(parsed.timeframe),
      scrollTop:
        typeof parsed.scrollTop === "number" && parsed.scrollTop >= 0
          ? parsed.scrollTop
          : 0,
    };
  } catch {
    return null;
  }
}

export function writeMobileAppSession(input: {
  appTab: AppTab;
  screenerSelected: StockPick | null;
  lookupSelected: StockPick | null;
  timeframe: ChartTimeframe;
  scrollTop: number;
}): void {
  if (typeof localStorage === "undefined") return;
  const next: MobileAppSessionV1 = {
    version: 1,
    savedAt: Date.now(),
    appTab: resolvePersistedAppTab(input.appTab),
    screenerSelected: pickToSessionPick(input.screenerSelected),
    lookupSelected: pickToSessionPick(input.lookupSelected),
    timeframe: normalizeTimeframe(input.timeframe),
    scrollTop: Math.max(0, Math.round(input.scrollTop)),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}
