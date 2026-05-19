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
  /** macro-releases.json 등에서만 채움; 없으면 UI에서「발표 전」 */
  forecast?: string | null;
}

export interface MacroEventsResponse {
  events: MacroEvent[];
  sectorEarnings: SectorEarningsSpotlightItem[];
  updatedAt: number;
}

/** Yahoo calendarEvents 기준 — 주목 섹터(서버 JSON) 예정 실적 */
export interface SectorEarningsSpotlightItem {
  id: string;
  sectorId: string;
  sectorLabel: string;
  symbol: string;
  name: string;
  market: Market;
  at: number;
  timezone: string;
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
  /** 당일 거래대금 (거래량 × 현재가) */
  turnover?: number;
}

/** GET /api/crypto-quotes — USDT 키는 빗썸 KRW 공개 API, 그 외 Yahoo 차트 스냅샷 */
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
  change?: number;
  changePercent?: number;
  currency?: string;
  score: number;
  signalIds?: string[];
  signals: string[];
  marketState?: string;
  dayHigh?: number;
  dayLow?: number;
  /** 당일 거래대금 (거래량 × 현재가) */
  turnover?: number;
  /** 미국 종목 한글 표기(검색·로컬 맵) */
  nameKo?: string;
  /** 미국 종목 영문 회사명(검색 보조) */
  nameEn?: string;
  /** 상승 유망 탭용 근거 문장 */
  bullishReasons?: string[];
  /** 일별 스냅샷 기준 연속 추천·첫 추천가 대비 등(서버) */
  pickStats?: PickRecommendationStats;
}

export interface PickRecommendationStats {
  consecutiveWeekdays: number;
  firstPickDate?: string;
  firstPickPrice?: number;
  sinceFirstPickPct: number | null;
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
  /** 당일 거래대금 (거래량 × 현재가) */
  turnover?: number;
}

/** GET /api/fx/usd-krw */
export interface UsdKrwRateResponse {
  rate: number;
  updatedAt: number;
}

export interface StockSearchResponse {
  quotes: StockSearchQuoteRow[];
}

/** GET /api/stock/:symbol/technical — 스크리너와 동일 일봉·기술적 분석 */
export interface StockTechnicalResponse {
  symbol: string;
  score: number;
  signalIds: string[];
  signals: string[];
  buy: boolean;
  candleCount: number;
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

export interface PicksDailyHistorySlimPick {
  symbol: string;
  name: string;
  price?: number | null;
  currency?: string | null;
  /** 최초 스냅샷 기록 시각(ms) */
  recordedAtMs?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  signalIds?: string[];
  score?: number | null;
}

export type RecommendationOutcome = "win" | "loss" | "flat" | "unknown";

export interface RecommendationTrackerRollup {
  total: number;
  wins: number;
  losses: number;
  flats: number;
  unknown: number;
  winRatePct: number | null;
}

export interface RecommendationTrackerItem {
  id: string;
  date: string;
  market: Market;
  symbol: string;
  name: string;
  currency: string;
  entryPrice: number | null;
  recordedAtMs: number | null;
  signalIds: string[];
  score: number | null;
  currentPrice: number | null;
  changePct: number | null;
  outcome: RecommendationOutcome;
}

export interface RecommendationSignalStat extends RecommendationTrackerRollup {
  signalId: string;
}

export interface RecommendationScoreStat extends RecommendationTrackerRollup {
  score: number;
}

export interface RecommendationSymbolStat extends RecommendationTrackerRollup {
  symbol: string;
  name: string;
  market: Market;
}

export interface RecommendationsTrackerResponse {
  updatedAtMs: number;
  summary: RecommendationTrackerRollup;
  signalStats: RecommendationSignalStat[];
  scoreStats: RecommendationScoreStat[];
  symbolStats: RecommendationSymbolStat[];
  items: RecommendationTrackerItem[];
}

export interface PicksDailyHistoryDay {
  date: string;
  scannedAtMs: number;
  kr: PicksDailyHistorySlimPick[];
  us: PicksDailyHistorySlimPick[];
}

export interface PicksDailyHistoryResponse {
  days: PicksDailyHistoryDay[];
}

export interface RefreshResponse {
  ok: boolean;
  message?: string;
}
