/** 거래내역 시나리오 — 시뮬은 앱 저장만, 실매매만 거래소 API */
export type LiveTradeHistoryScenario = "sim" | "live-bithumb" | "live-toss";

export const LIVE_TRADE_HISTORY_SCENARIOS: LiveTradeHistoryScenario[] = [
  "sim",
  "live-bithumb",
  "live-toss",
];
