export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type Market = "kr" | "us";

/** 텔레그램 발송 이력 등 — 코인 알림 확장용 */
export type TelegramSentMarket = Market | "crypto";

export type MacroImportance = "high" | "medium";
export type MacroRegion = "us" | "kr";

export interface MacroEvent {
  id: string;
  code: string;
  name: string;
  region: MacroRegion;
  importance: MacroImportance;
  category: string;
  at: number;
  timezone: string;
}

export interface MacroEventsResponse {
  events: MacroEvent[];
  updatedAt: number;
}

export type ChartTime =
  | number
  | { year: number; month: number; day: number };

export interface Candle {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartResponse {
  symbol: string;
  currency?: string;
  interval?: string;
  candleCount?: number;
  candles: Candle[];
  /** 분봉·시간봉 차트에 일봉 기준 이평선 표시용 */
  dailyCandles?: Candle[];
  stale?: boolean;
  updatedAt?: number;
}

export interface QuoteResponse {
  symbol: string;
  name: string;
  price?: number;
  change?: number;
  changePercent?: number;
  currency?: string;
  marketState?: string;
}

/** GET /api/crypto-quotes — USDT는 Binance 배치, 그 외 Yahoo 차트 스냅샷 */
export interface CryptoQuotesResponse {
  quotes: Record<string, QuoteResponse>;
  updatedAt: number;
}

/** GET /api/crypto-universe — 고정 3 + 거래량 상위 7 (USDT 기준, 거래량 내림차순) */
export interface CryptoUniverseAsset {
  symbol: string;
  name: string;
  quoteVolume: number;
}

export interface CryptoUniverseResponse {
  assets: CryptoUniverseAsset[];
  updatedAt: number;
}

export interface StockPick {
  symbol: string;
  name: string;
  market: Market;
  price?: number;
  changePercent?: number;
  currency?: string;
  score: number;
  signalIds?: string[];
  signals: string[];
  /** 미국 종목 한글 표기(검색·로컬 맵) */
  nameKo?: string;
  /** 미국 종목 영문 회사명(검색 보조) */
  nameEn?: string;
  /** 상승 유망 탭용 근거 문장 */
  bullishReasons?: string[];
}

/** GET /api/stock-search — Yahoo Finance 심볼 검색 (국내·미국 시장 필터) */
export interface StockSearchQuoteRow {
  symbol: string;
  name: string;
  market: Market;
  exchange?: string;
  quoteType?: string;
  nameKo?: string | null;
  nameEn?: string | null;
  price?: number;
  changePercent?: number;
  currency?: string;
  marketState?: string;
}

/** GET /api/fx/usd-krw */
export interface UsdKrwRateResponse {
  rate: number;
  updatedAt: number;
}

export interface StockSearchResponse {
  quotes: StockSearchQuoteRow[];
}

export type NewsKind = "news" | "disclosure";
export type NewsSentiment = "positive" | "negative" | "neutral";

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  type: NewsKind;
  sentiment: NewsSentiment;
}

export interface NewsResponse {
  symbol: string;
  name: string;
  items: NewsItem[];
  updatedAt: number;
}

export interface ScreenFailure {
  symbol: string;
  name: string;
  market: Market;
  reason: string;
}

export interface TelegramSentItem {
  market: TelegramSentMarket;
  symbol: string;
  name: string;
  score: number;
  sentAt: number;
  price?: number | null;
  changePercent?: number | null;
  currency?: string | null;
}

export interface TelegramSentResponse {
  items: TelegramSentItem[];
  count: number;
}

export interface FeedbackComment {
  id: string;
  at: string;
  message: string;
}

export interface FeedbackInboxItem {
  id: string;
  at: string;
  ip: string;
  userAgent: string;
  message: string;
  comments?: FeedbackComment[];
}

export interface FeedbackInboxResponse {
  items: FeedbackInboxItem[];
  count: number;
}

export interface PicksResponse {
  running: boolean;
  progress: number;
  total: number;
  failedCount?: number;
  failures?: ScreenFailure[];
  etaSeconds?: number | null;
  /** 다음 자동 재스캔 예정 시각 (ms, 서버 기준) */
  nextScanAt?: number | null;
  /** 자동 재스캔 주기 (ms) */
  scanIntervalMs?: number;
  kr: StockPick[];
  us: StockPick[];
  updatedAt: number | null;
  message: string;
}

export interface RefreshResponse {
  ok: boolean;
  message?: string;
}
