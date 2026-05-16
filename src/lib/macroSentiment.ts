/** 주식(광범위 지수) 관점: 예상보다 높음/낮음 시장 영향 — UI 색상용 */
export type MacroMarketSentiment = "positive" | "negative";

export interface MacroScenarioSentiment {
  high: MacroMarketSentiment;
  low: MacroMarketSentiment;
}

const SENTIMENT_BY_CODE: Record<string, MacroScenarioSentiment> = {
  CPI: { high: "negative", low: "positive" },
  PPI: { high: "negative", low: "positive" },
  PCE: { high: "negative", low: "positive" },
  KR_CPI: { high: "negative", low: "positive" },
  NFP: { high: "negative", low: "positive" },
  ADP: { high: "negative", low: "positive" },
  JOLTS: { high: "negative", low: "positive" },
  JOBLESS: { high: "negative", low: "positive" },
  FOMC: { high: "negative", low: "positive" },
  FOMC_MINUTES: { high: "negative", low: "positive" },
  KR_BOK: { high: "negative", low: "positive" },
  GDP: { high: "positive", low: "negative" },
  RETAIL: { high: "positive", low: "negative" },
  CONSUMER_CONF: { high: "positive", low: "negative" },
  ISM_MFG: { high: "positive", low: "negative" },
  ISM_SVC: { high: "positive", low: "negative" },
};

/** ‘숫자가 예상보다 높게’ 나올 때 광범위 지수 쪽으로 자주 해석되는 방향 (카드 힌트용) */
export type MacroSurpriseUpBias = "positive" | "negative" | "neutral";

export function getMacroScenarioSentiment(
  code: string,
): MacroScenarioSentiment | null {
  const key = code.replace(/^KR_/, "");
  return SENTIMENT_BY_CODE[key] ?? null;
}

export function getMacroSurpriseUpBias(code: string): MacroSurpriseUpBias {
  const s = getMacroScenarioSentiment(code);
  if (!s) return "neutral";
  return s.high;
}
