export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type Market = "kr" | "us" | "crypto";

/** 상단 메인 네비 탭 */
export type AppTab =
  | "screener"
  | "recommendations"
  | "liveTrading"
  | "stockLookup"
  | "crypto"
  | "tradeHistory"
  | "boxRange"
  | "financials"
  | "stockVault"
  | "investorFlow"
  | "ops";

/** 실매매·시뮬 포트폴리오 시장 */
export type LiveTradeMarket = Market | "crypto";

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
  /** @deprecated 별도 GET /api/sector-earnings 사용 */
  sectorEarnings?: SectorEarningsSpotlightItem[];
  updatedAt: number;
  forecastsEnriched?: boolean;
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

/** GET /api/crypto-quotes — USDT 키는 Binance USDT, 그 외 Yahoo 차트 스냅샷 */
export interface CryptoQuotesResponse {
  quotes: Record<string, QuoteResponse>;
  updatedAt: number;
}

/** GET /api/crypto-universe — 고정 3 + 거래대금 상위 7 (KRW, 거래대금 내림차순) */
export interface CryptoUniverseAsset {
  symbol: string;
  name: string;
  quoteTurnoverKrw: number;
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
  /** 미국 거래소(NYSE·NASDAQ 등) — TradingView 심볼 매핑 */
  exchange?: string;
  /** 상승 유망 탭용 근거 문장 */
  bullishReasons?: string[];
  techModelId?: string;
  techModelName?: string;
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
  /** KST 기준 환율 기준일 (YYYY-MM-DD) */
  valuationDate?: string;
  /** kst_9am = 해당일 09:00 KST(공휴·주말·09시 전 → 직전 영업일 09:00) */
  basis?: string;
  /** 09:00 봉 시각(ms) */
  asOfMs?: number | null;
}

export interface MarketIndexItem {
  id: string;
  symbol: string;
  label: string;
  region: "kr" | "us";
  kind?: "index" | "fx";
  lookupMarket?: "kr" | "us";
  price: number | null;
  changePercent: number | null;
  currency?: string;
  marketState?: string;
}

export interface MarketIndicesResponse {
  items: MarketIndexItem[];
  updatedAt: number;
}

export interface StockSearchResponse {
  quotes: StockSearchQuoteRow[];
}

export interface StockSearchHotResponse {
  quotes: StockSearchQuoteRow[];
  updatedAt: number;
}

export interface StockTechnicalSignalBreakdown {
  id: string;
  label: string;
  met: boolean;
  weight: number;
}

/** GET /api/stock/:symbol/technical — 스크리너와 동일 일봉·기술적 분석 */
export interface StockTechnicalResponse {
  symbol: string;
  score: number;
  signalIds: string[];
  signals: string[];
  buy: boolean;
  candleCount: number;
  techModelId?: string;
  techModelName?: string;
  techModelMaxScore?: number;
  conditionsMet?: number;
  conditionsTotal?: number;
  conditionsRequired?: number;
  maxScore?: number;
  scorePct?: number;
  scorePctLabel?: string;
  telegramEligible?: boolean;
  minTelegramScore?: number;
  insufficientData?: boolean;
  signalBreakdown?: StockTechnicalSignalBreakdown[];
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

export interface StockFundamentalsResponse {
  symbol: string;
  name: string;
  currency: string;
  market: "kr" | "us";
  price: number | null;
  eps: number | null;
  forwardEps: number | null;
  bps: number | null;
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  marketCap: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  roe: number | null;
  source: string;
  sourceNote: string;
  updatedAt: number;
}

export interface FinancialPeriodRow {
  id: string;
  label: string;
  kind: "annual" | "quarter";
  endDateMs: number | null;
  isForecast: boolean;
  source: string;
}

export interface FinancialPeriodsResponse {
  symbol: string;
  name: string;
  market: "kr" | "us";
  currency: string;
  periods: FinancialPeriodRow[];
  updatedAt: number;
}

export interface FinancialStatementLineRow {
  label: string;
  value: string;
  priorValue?: string | null;
  yoyPct?: number | null;
  prevAnnounceValue?: string | null;
  prevAnnouncePct?: number | null;
}

export interface FinancialStatementSection {
  title: string;
  unitNote?: string;
  rows: FinancialStatementLineRow[];
}

export interface FinancialAiOpinion {
  summary: string;
  bullets: string[];
  peerGroup: string;
  disclaimer: string;
}

export interface FinancialPeerComparison {
  peerGroup: string;
  medianPer: number | null;
  medianPbr: number | null;
  medianRoe: number | null;
  medianProfitMargin: number | null;
}

export interface FinancialStatementDetailResponse {
  symbol: string;
  periodId: string;
  label: string;
  kind: "annual" | "quarter";
  isForecast: boolean;
  sections: FinancialStatementSection[];
  source: string;
  updatedAt: number;
}

export interface FinancialPeriodMetrics {
  periodId: string;
  periodLabel: string;
  kind: "annual" | "quarter";
  isForecast: boolean;
  currency: string;
  market: "kr" | "us";
  per: number | null;
  forwardPer: number | null;
  eps: number | null;
  forwardEps: number | null;
  bps: number | null;
  pbr: number | null;
  price: number | null;
  marketCap: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  roe: number | null;
  valuationBasis?: "period_statement" | "disclosure_proxy" | null;
  disclosureDateMs?: number | null;
}

export interface FinancialStatementAnalysisResponse extends FinancialStatementDetailResponse {
  priorPeriodId: string | null;
  priorPeriodLabel: string | null;
  prevAnnouncePeriodId: string | null;
  prevAnnouncePeriodLabel: string | null;
  periodMetrics: FinancialPeriodMetrics;
  peerComparison: FinancialPeerComparison;
  aiOpinion: FinancialAiOpinion;
}

export type StockVaultSource = "golden_cross" | "ma_align" | "favorite";
/** 자동 탐색 조건 — stockVaultFilter.STOCK_VAULT_SCAN_SOURCES 와 동기 */
export type StockVaultScanSource = "golden_cross" | "ma_align";
export type StockVaultTimeframe = "1d" | "1wk";
export type GoldenCrossKind =
  | "5>20"
  | "5<20"
  | "20>120"
  | "20<120"
  | "5>60"
  | "5>120";
export type StockVaultKindTab = "golden_cross" | "ma_align";

export type StockVaultToggleResult =
  | { action: "removed" }
  | {
      action: "added";
      addedAtMs: number;
      favoritePrice: number | null;
    };

export interface StockVaultFavoriteMeta {
  name: string;
  market: "kr" | "us";
  addedAtMs: number;
  updatedAtMs: number;
  favoritePrice?: number | null;
}

export interface StockVaultItem {
  id: string;
  symbol: string;
  name: string;
  market: "kr" | "us";
  source: StockVaultSource;
  /** 자동탐색 봉 구간 — legacy 항목은 1d */
  timeframe?: StockVaultTimeframe;
  crosses?: GoldenCrossKind[];
  /** 골든크로스가 발생한 일봉 날짜 (YYYY-MM-DD) */
  crossDate?: string | null;
  scanDate?: string | null;
  addedAtMs: number;
  updatedAtMs: number;
  favorited?: boolean;
  /** 즐겨찾기 등록 시각(ms) — D+N 계산용 */
  favoriteAddedAtMs?: number | null;
  /** 즐겨찾기 등록(또는 수정) 기준가 */
  favoritePrice?: number | null;
}

export interface StockVaultIndustryFinancials {
  industry?: string | null;
  per?: number | null;
  roe?: number | null;
  pbr?: number | null;
  profitMargin?: number | null;
  marketCap?: number | null;
  industryMedianPer?: number | null;
  industryMedianRoe?: number | null;
  industryMedianProfitMargin?: number | null;
  industryMedianPbr?: number | null;
  industryPeerCount?: number;
  industryUniversePeerCount?: number | null;
  marketCapRankInIndustry?: number | null;
  sectorLeader?: boolean;
  sectorLeaderDetail?: string | null;
  sectorLeaderCriteria?: string[];
  verdict?: "better" | "worse" | "similar" | "unknown";
  verdictLabel?: string;
  verdictDetail?: string;
  peerGroup?: string;
  updatedAtMs?: number;
}

export type StockVaultTrend = "up" | "down" | "neutral";

export type StockVaultMaProximityHit = {
  period: number;
  ma: number;
  diffPct: number;
  side: "above" | "below";
  approach: "from_below" | "from_above" | "flat";
};

export type StockVaultTimeframeChartInsight = {
  trend: StockVaultTrend;
  near: StockVaultMaProximityHit[];
};

export type StockVaultChartInsightSnapshot = {
  daily: StockVaultTimeframeChartInsight;
  weekly: StockVaultTimeframeChartInsight;
  updatedAtMs?: number;
};

/** @deprecated */
export type StockVaultWeeklyMaProximityHit = StockVaultMaProximityHit;

/** @deprecated */
export type StockVaultWeeklyMaProximitySnapshot = {
  near: StockVaultMaProximityHit[];
  updatedAtMs?: number;
};

export interface StockVaultResponse {
  items: StockVaultItem[];
  quotes?: Record<
    string,
    {
      price: number;
      changePercent?: number;
      currency?: string;
      quotedAtMs?: number;
    }
  >;
  meta?: Record<
    string,
    {
      industry?: string | null;
      nameKo?: string | null;
      tvSymbol?: string | null;
      exchange?: string | null;
    }
  >;
  industryFinancials?: Record<string, StockVaultIndustryFinancials>;
  chartInsights?: Record<string, StockVaultChartInsightSnapshot>;
  /** @deprecated chartInsights 사용 */
  weeklyMaProximity?: Record<string, StockVaultWeeklyMaProximitySnapshot>;
  industryTabs?: string[];
  industryGridRows?: number;
  authenticated?: boolean;
  favoriteSymbols?: string[];
  favoriteMeta?: Record<string, StockVaultFavoriteMeta>;
}

export interface KrInvestorFlowItem {
  symbol: string;
  name: string;
  bizDate?: string | null;
  closePrice?: number | null;
  foreignNetQty?: number | null;
  foreignHoldRatio?: number | null;
  institutionNetQty?: number | null;
  individualNetQty?: number | null;
  accumulatedVolume?: number | null;
}

export interface KrInvestorFlowResponse {
  version?: number;
  updatedAtMs?: number;
  bizDate?: string | null;
  scanned?: number;
  itemCount?: number;
  items: KrInvestorFlowItem[];
}

export interface GoldenCrossScanState {
  krLastScanDate: string | null;
  usLastScanDate: string | null;
  krWeeklyLastScanDate?: string | null;
  usWeeklyLastScanDate?: string | null;
  lastRuns: Array<{
    market: "kr" | "us";
    scanDate: string;
    timeframe?: StockVaultTimeframe;
    scanned: number;
    hits: number;
    atMs: number;
  }>;
}

export interface GoldenCrossHistoryHit {
  symbol: string;
  name: string;
  market: "kr" | "us";
  crosses: GoldenCrossKind[];
  scanDate: string;
  crossDate?: string | null;
}

export interface MaAlignHistoryHit {
  symbol: string;
  name: string;
  market: "kr" | "us";
  scanDate: string;
}

export interface GoldenCrossHistoryEntry {
  id: string;
  runId: string;
  atMs: number;
  trigger: "manual" | "scheduled";
  market: "kr" | "us";
  scanDate: string;
  timeframe?: StockVaultTimeframe;
  scanned: number;
  hitCount: number;
  hits: GoldenCrossHistoryHit[];
}

export interface MaAlignHistoryEntry {
  id: string;
  runId: string;
  atMs: number;
  trigger: "manual" | "scheduled";
  market: "kr" | "us";
  scanDate: string;
  timeframe?: StockVaultTimeframe;
  scanned: number;
  hitCount: number;
  hits: MaAlignHistoryHit[];
}

export interface GoldenCrossHistoryResponse {
  dates?: string[];
  scanDate?: string;
  entries?: GoldenCrossHistoryEntry[];
}

export interface MaAlignHistoryResponse {
  dates?: string[];
  scanDate?: string;
  entries?: MaAlignHistoryEntry[];
}

export interface StockVaultScanStatus {
  enabled: boolean;
  running: boolean;
  lastManualScan: {
    atMs: number;
    goldenCross: Array<{
      market: "kr" | "us";
      scanDate: string;
      scanned: number;
      hitCount: number;
    }>;
    maAlign: Array<{
      market: "kr" | "us";
      scanDate: string;
      scanned: number;
      hitCount: number;
    }>;
  } | null;
  goldenCross: { state: GoldenCrossScanState };
  maAlign: { state: GoldenCrossScanState };
  state: GoldenCrossScanState;
}

export interface DartCompanyRow {
  corpCode: string;
  corpName: string;
  stockCode: string;
  symbol: string;
}

export interface DartDisclosureRow {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  type: "disclosure";
  corpCode: string | null;
  corpName: string;
  stockCode: string | null;
  symbol: string | null;
  rceptNo: string | null;
  flrNm: string;
}

export interface DartDisclosuresSearchResponse {
  enabled: boolean;
  items: DartDisclosureRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  corpCode: string | null;
  days: number;
}

export interface DartStatusResponse {
  enabled: boolean;
  corpIndexReady: boolean;
  corpCount: number;
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
  crypto: StockPick[];
  updatedAt: number | null;
  message: string;
  /** 스캔 범위 표시(항상 전체 문구) */
  scanScopeLabel?: string;
  /** false면 UI에서 해당 구간만 비활성(투명) 표시 */
  scanScopeKrActive?: boolean;
  scanScopeUsActive?: boolean;
  scanIncludeKr?: boolean;
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
  /** 해당 KST 일자에 텔레그램 알림 발송 이력이 있으면 true */
  telegramNotified?: boolean;
  /** 알림 발송 시각(ms), KST */
  telegramNotifiedAtMs?: number | null;
  /** 알림을 보낸 기술 분석 모델 */
  techModelId?: string | null;
  techModelName?: string | null;
}

export interface RecommendationModelStat extends RecommendationTrackerRollup {
  modelId: string;
  modelName: string;
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
  /** 디스크 스냅샷 시각(서버) */
  snapshotAtMs?: number | null;
  /** true면 picks-recommendations-tracker-snapshot.json 기반 */
  fromSnapshot?: boolean;
  /** KST 일자 목록(최신순) */
  dates: string[];
  summary: RecommendationTrackerRollup;
  signalStats: RecommendationSignalStat[];
  scoreStats: RecommendationScoreStat[];
  symbolStats: RecommendationSymbolStat[];
  modelStats: RecommendationModelStat[];
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
