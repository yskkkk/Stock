import type { RecommendationTrackerItem } from "../types";

/** 수수료 반영 등락률이 이 값(%)을 초과한 종목을 '큰 상승'으로 본다 */
export const REC_TRACKER_BIG_GAIN_PCT = 5;

export type BigGainSignalStat = {
  signalId: string;
  /** 해당 사인이 붙은 5%↑ 추천 건수 */
  hitCount: number;
  /** 포함된 서로 다른 종목 수 */
  symbolCount: number;
  /** 해당 사인 건 평균 등락(%) */
  avgGainPct: number | null;
};

export function isBigGainItem(
  item: Pick<RecommendationTrackerItem, "changePct">,
  minPct = REC_TRACKER_BIG_GAIN_PCT,
): boolean {
  return (
    item.changePct != null &&
    Number.isFinite(item.changePct) &&
    item.changePct > minPct
  );
}

/** 5% 초과 상승 종목에서 발견된 매수 사인(근거) 집계 */
export function aggregateBigGainSignals(
  items: RecommendationTrackerItem[],
  minPct = REC_TRACKER_BIG_GAIN_PCT,
): BigGainSignalStat[] {
  const big = items.filter((it) => isBigGainItem(it, minPct));
  const bySignal = new Map<
    string,
    { hitCount: number; symbols: Set<string>; gainSum: number; gainN: number }
  >();

  for (const it of big) {
    const ids = it.signalIds.length ? it.signalIds : [];
    const sym = `${it.market}:${it.symbol}`;
    const pct = it.changePct!;
    for (const signalId of ids) {
      const cur = bySignal.get(signalId) ?? {
        hitCount: 0,
        symbols: new Set<string>(),
        gainSum: 0,
        gainN: 0,
      };
      cur.hitCount++;
      cur.symbols.add(sym);
      cur.gainSum += pct;
      cur.gainN++;
      bySignal.set(signalId, cur);
    }
  }

  return [...bySignal.entries()]
    .map(([signalId, c]) => ({
      signalId,
      hitCount: c.hitCount,
      symbolCount: c.symbols.size,
      avgGainPct: c.gainN > 0 ? c.gainSum / c.gainN : null,
    }))
    .sort((a, b) => b.hitCount - a.hitCount || b.symbolCount - a.symbolCount);
}

export function countBigGainStocks(
  items: RecommendationTrackerItem[],
  minPct = REC_TRACKER_BIG_GAIN_PCT,
): number {
  const keys = new Set<string>();
  for (const it of items) {
    if (!isBigGainItem(it, minPct)) continue;
    keys.add(`${it.market}:${it.symbol}`);
  }
  return keys.size;
}
