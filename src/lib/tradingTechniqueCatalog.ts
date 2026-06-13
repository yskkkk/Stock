import { ko } from "../i18n/ko";
import type { StockVaultItem, StockVaultScanSource } from "../types";

/** 매매기법 선택 목록 — vault 자동탐색 유형 + 신규 항목만 추가 */
export type TradingTechniqueEntry = {
  id: string;
  name: string;
  scanSources: StockVaultScanSource[];
};

export const TRADING_TECHNIQUE_ENTRIES: readonly TradingTechniqueEntry[] = [
  {
    id: "golden_cross",
    name: ko.stockVault.tabGolden,
    scanSources: ["golden_cross"],
  },
  {
    id: "ma_align",
    name: ko.stockVault.tabMaAlign,
    scanSources: ["ma_align"],
  },
  {
    id: "ma120_near",
    name: ko.stockVault.tabMa120Near,
    scanSources: ["ma120_near"],
  },
  {
    id: "bottom_candle",
    name: "세력 바닥 캔들",
    scanSources: ["bottom_candle"],
  },
];

export function findTradingTechniqueEntry(id: string | null | undefined) {
  const key = String(id ?? "").trim();
  if (!key) return null;
  return TRADING_TECHNIQUE_ENTRIES.find((e) => e.id === key) ?? null;
}

export function countVaultItemsForTechnique(
  items: StockVaultItem[],
  entry: TradingTechniqueEntry,
): number {
  const seen = new Set<string>();
  for (const it of items) {
    if (!entry.scanSources.includes(it.source as StockVaultScanSource)) continue;
    seen.add(
      `${it.market}:${it.symbol.trim().toUpperCase()}:${it.timeframe ?? "1d"}`,
    );
  }
  return seen.size;
}
