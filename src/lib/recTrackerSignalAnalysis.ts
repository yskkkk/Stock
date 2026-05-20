import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import { FILTER_OPTIONS } from "../constants/signals";
import type {
  RecommendationTrackerItem,
  RecommendationTrackerRollup,
} from "../types";

export type SignalAnalysisSeverity = "low" | "watch";

export interface SignalAnalysisInsight {
  signalId: SignalId;
  label: string;
  short: string;
  winRatePct: number;
  decided: number;
  wins: number;
  losses: number;
  baselineWinRatePct: number;
  deltaVsBaseline: number;
  bullets: string[];
  severity: SignalAnalysisSeverity;
}

export interface RecTrackerSignalAnalysisResult {
  baseline: RecommendationTrackerRollup;
  insights: SignalAnalysisInsight[];
}

const MIN_DECIDED = 8;
const LOW_DELTA_PP = 5;
const MAX_INSIGHTS = 5;

/** 근거별 맥락 설명(추가 통계와 함께 표시) */
const SIGNAL_CONTEXT_HINT: Partial<Record<SignalId, string>> = {
  high_60:
    "60일 고가 근접은 조정·눌림 구간에서 추격 매수가 되기 쉬워, 추천 이후 되돌림(패) 비율이 높아질 수 있습니다.",
  ma_align:
    "정배열은 추세 후반·과열 구간에서 자주 잡혀, 진입 시점이 늦어 승률이 깎이는 경우가 있습니다.",
  rsi: "RSI 상승만으로는 횡보·단기 과열에서 실패가 잦을 수 있습니다.",
  macd: "MACD는 신호가 늦게 나오는 편이라, 추천 시점엔 단기 상승이 이미 소진된 경우가 많습니다.",
  ma20: "20봉 위는 단기 반등 후 재하락에 취약한 추천이 섞일 수 있습니다.",
  ma50: "중기 이평 위는 느린 지표라, 약세장 반등 추천과 겹치면 승률이 낮아질 수 있습니다.",
  ma5_align: "5·20 단기 정배열은 변동성 큰 종목에서 휩쏘 후 패가 늘 수 있습니다.",
  volume: "거래량 증가만으로는 가격 방향 확인이 부족해 실패 비율이 높을 수 있습니다.",
  volume_surge: "거래량 급증은 뉴스·단타성 장대양봉 직후에 잡혀 되돌림 패가 늘 수 있습니다.",
  ma_golden: "골든크로스 직후는 이미 많이 오른 뒤인 경우가 많아 기대 승률이 낮아질 수 있습니다.",
  bull_bar: "양봉 단독은 전일 대비 반등 한 번에 그친 뒤 패로 이어지는 경우가 있습니다.",
};

function rollupItems(items: RecommendationTrackerItem[]): RecommendationTrackerRollup {
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let unknown = 0;
  for (const it of items) {
    if (it.outcome === "win") wins++;
    else if (it.outcome === "loss") losses++;
    else if (it.outcome === "flat") flats++;
    else unknown++;
  }
  const decided = wins + losses;
  return {
    total: items.length,
    wins,
    losses,
    flats,
    unknown,
    winRatePct: decided > 0 ? (wins / decided) * 100 : null,
  };
}

function winRateFromItems(items: RecommendationTrackerItem[]): {
  wins: number;
  losses: number;
  decided: number;
  winRatePct: number | null;
} {
  let wins = 0;
  let losses = 0;
  for (const it of items) {
    if (it.outcome === "win") wins++;
    else if (it.outcome === "loss") losses++;
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    decided,
    winRatePct: decided > 0 ? (wins / decided) * 100 : null,
  };
}

function avgScore(items: RecommendationTrackerItem[]): number | null {
  const scores = items
    .map((it) => it.score)
    .filter((s): s is number => s != null && Number.isFinite(s));
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function avgLossPct(items: RecommendationTrackerItem[]): number | null {
  const pcts = items
    .filter((it) => it.outcome === "loss" && it.changePct != null && Number.isFinite(it.changePct))
    .map((it) => it.changePct as number);
  if (!pcts.length) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

function marketWinRate(
  items: RecommendationTrackerItem[],
  market: "kr" | "us",
): number | null {
  return winRateFromItems(items.filter((it) => it.market === market)).winRatePct;
}

function topCoSignals(
  items: RecommendationTrackerItem[],
  signalId: SignalId,
  limit = 2,
): { id: SignalId; label: string; winRatePct: number | null; count: number }[] {
  const counts = new Map<SignalId, RecommendationTrackerItem[]>();
  for (const it of items) {
    for (const id of it.signalIds) {
      if (id === signalId) continue;
      if (!counts.has(id as SignalId)) counts.set(id as SignalId, []);
      counts.get(id as SignalId)!.push(it);
    }
  }
  return [...counts.entries()]
    .map(([id, group]) => ({
      id,
      label: signalChipMeta(id).short,
      winRatePct: winRateFromItems(group).winRatePct,
      count: group.length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function buildBullets(
  signalId: SignalId,
  pool: RecommendationTrackerItem[],
  baselinePct: number,
  stat: { winRatePct: number; decided: number; wins: number; losses: number },
): string[] {
  const bullets: string[] = [];
  const delta = stat.winRatePct - baselinePct;
  bullets.push(
    `전체 승률 ${baselinePct.toFixed(1)}% 대비 ${Math.abs(delta).toFixed(1)}%p 낮습니다.`,
  );

  if (stat.decided < 15) {
    bullets.push(`승패 확정 ${stat.decided}건으로 표본이 적어 해석은 참고용입니다.`);
  }

  const withSignal = pool.filter((it) => it.signalIds.includes(signalId));
  const solo = withSignal.filter((it) => it.signalIds.length === 1);
  const multi = withSignal.filter((it) => it.signalIds.length > 1);
  const soloR = winRateFromItems(solo);
  const multiR = winRateFromItems(multi);

  if (soloR.decided >= 4 && multiR.decided >= 4 && soloR.winRatePct != null && multiR.winRatePct != null) {
    if (soloR.winRatePct < baselinePct - 3 && multiR.winRatePct < baselinePct - 3) {
      bullets.push(
        `단독 ${soloR.winRatePct.toFixed(1)}%(${soloR.decided}건)·복합 ${multiR.winRatePct.toFixed(1)}%(${multiR.decided}건) 모두 낮아 이 근거 자체가 약한 편입니다.`,
      );
    } else if (multiR.winRatePct < soloR.winRatePct - 8) {
      bullets.push(
        `단독 ${soloR.winRatePct.toFixed(1)}%인데 다른 근거와 함께일 때 ${multiR.winRatePct.toFixed(1)}%로 더 낮습니다. 조합을 의심해 보세요.`,
      );
    } else if (soloR.winRatePct < multiR.winRatePct - 8) {
      bullets.push(
        `다른 근거와 묶일 때 ${multiR.winRatePct.toFixed(1)}%로 상대적으로 나으나, 단독은 ${soloR.winRatePct.toFixed(1)}%입니다.`,
      );
    }
  } else if (soloR.decided >= 4 && soloR.winRatePct != null) {
    bullets.push(`이 근거만 단독일 때 승률 ${soloR.winRatePct.toFixed(1)}% (${soloR.decided}건).`);
  } else if (multiR.decided >= 4 && multiR.winRatePct != null) {
    bullets.push(`다른 근거와 함께일 때 승률 ${multiR.winRatePct.toFixed(1)}% (${multiR.decided}건).`);
  }

  const avg = avgScore(withSignal);
  if (avg != null) {
    if (avg < 5) {
      bullets.push(`평균 점수 ${avg.toFixed(1)}점 — 낮은 점수 추천에 자주 포함됩니다.`);
    } else if (avg >= 7) {
      bullets.push(`평균 점수 ${avg.toFixed(1)}점 — 점수는 높은데도 승률이 낮아 조건·시장 환경을 의심할 수 있습니다.`);
    }
  }

  const kr = marketWinRate(withSignal, "kr");
  const us = marketWinRate(withSignal, "us");
  if (kr != null && us != null) {
    const krN = withSignal.filter((it) => it.market === "kr").length;
    const usN = withSignal.filter((it) => it.market === "us").length;
    if (krN >= 4 && usN >= 4 && Math.abs(kr - us) >= 12) {
      bullets.push(`시장별 승률 차이: 국내 ${kr.toFixed(1)}% · 미국 ${us.toFixed(1)}%.`);
    }
  }

  const lossAvg = avgLossPct(withSignal);
  if (lossAvg != null && lossAvg < -2.5) {
    bullets.push(`패배 시 평균 ${lossAvg.toFixed(2)}% — 손실 폭이 큰 편입니다.`);
  }

  const co = topCoSignals(withSignal, signalId);
  if (co.length > 0) {
    const parts = co
      .map((c) =>
        c.winRatePct != null
          ? `${c.label} ${c.winRatePct.toFixed(0)}%(${c.count})`
          : `${c.label}(${c.count})`,
      )
      .join(", ");
    bullets.push(`자주 함께 나온 근거: ${parts}.`);
  }

  const hint = SIGNAL_CONTEXT_HINT[signalId];
  if (hint) bullets.push(hint);

  return bullets.slice(0, 6);
}

/**
 * @param pool 칩 통계와 동일한 추천 풀(시장·일자 필터만 적용)
 */
export function analyzeLowSignalWinRates(
  pool: RecommendationTrackerItem[],
): RecTrackerSignalAnalysisResult {
  const baseline = rollupItems(pool);
  const baselinePct = baseline.winRatePct;
  if (baselinePct == null || baseline.wins + baseline.losses < MIN_DECIDED) {
    return { baseline, insights: [] };
  }

  const bySignal = new Map<SignalId, RecommendationTrackerItem[]>();
  for (const it of pool) {
    for (const id of it.signalIds) {
      const sid = id as SignalId;
      if (!bySignal.has(sid)) bySignal.set(sid, []);
      bySignal.get(sid)!.push(it);
    }
  }

  const candidates: SignalAnalysisInsight[] = [];

  for (const { id: signalId } of FILTER_OPTIONS) {
    const group = bySignal.get(signalId);
    if (!group?.length) continue;
    const { wins, losses, decided, winRatePct } = winRateFromItems(group);
    if (winRatePct == null || decided < MIN_DECIDED) continue;
    const delta = winRatePct - baselinePct;
    if (delta > -LOW_DELTA_PP) continue;

    const meta = signalChipMeta(signalId);
    candidates.push({
      signalId,
      label: meta.label,
      short: meta.short,
      winRatePct,
      decided,
      wins,
      losses,
      baselineWinRatePct: baselinePct,
      deltaVsBaseline: delta,
      bullets: buildBullets(signalId, pool, baselinePct, {
        winRatePct,
        decided,
        wins,
        losses,
      }),
      severity: delta <= -15 ? "low" : "watch",
    });
  }

  candidates.sort((a, b) => a.winRatePct - b.winRatePct);

  return {
    baseline,
    insights: candidates.slice(0, MAX_INSIGHTS),
  };
}
