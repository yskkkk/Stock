import type { SignalId } from "../constants/signals";

const DEFAULT_WEIGHT: Record<SignalId, number> = {
  ma_align: 2,
  ma_golden: 2,
  ma20: 1,
  ma50: 1,
  ma5_align: 1,
  rsi: 2,
  volume: 1,
  volume_surge: 1,
  macd: 1,
  high_60: 1,
  vp_breakout: 2,
  bull_bar: 0,
};

export const MAX_TECH_SCORE = 15;

let activeWeights: Record<string, number> | null = null;

export function setTechScoreWeights(weights: Record<string, number>) {
  activeWeights = { ...weights };
}

function weightFor(id: string): number {
  const w = activeWeights?.[id] ?? DEFAULT_WEIGHT[id as SignalId];
  return typeof w === "number" && Number.isFinite(w) ? w : 0;
}

export function weightedScoreFromSignalIds(ids: string[]): number {
  let n = 0;
  for (const id of ids) {
    n += weightFor(id);
  }
  return n;
}

/** 기록된 근거 가중합이 점수와 크게 어긋날 때 */
export function recTrackerScoreSignalMismatch(
  score: number | null | undefined,
  signalIds: string[],
): boolean {
  if (score == null || !Number.isFinite(score) || score < 8) return false;
  if (!signalIds.length) return true;
  return weightedScoreFromSignalIds(signalIds) + 3 <= score;
}
