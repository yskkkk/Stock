import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import { FILTER_OPTIONS } from "../constants/signals";
import type {
  RecommendationTrackerItem,
  RecommendationTrackerRollup,
} from "../types";

export type SignalAnalysisSeverity = "low" | "watch";

export interface SignalAnalysisMetrics {
  /** 추천 풀 대비 이 근거 포함 비율 */
  poolSharePct: number;
  /** 승패 확정 건 평균 등락 */
  avgChangePct: number | null;
  /** 승리 건 평균 등락 */
  avgWinPct: number | null;
  /** 패배 건 평균 등락 */
  avgLossPct: number | null;
  /** 기대 등락(승률×평균승 − 패률×|평균패|) 근사 */
  expectancyPct: number | null;
  /** 함께 붙는 근거 개수 평균 */
  avgCoSignalCount: number;
  soloWinRatePct: number | null;
  soloDecided: number;
  multiWinRatePct: number | null;
  multiDecided: number;
  highScoreWinRatePct: number | null;
  highScoreDecided: number;
  lowScoreWinRatePct: number | null;
  lowScoreDecided: number;
  krWinRatePct: number | null;
  krDecided: number;
  usWinRatePct: number | null;
  usDecided: number;
  /** 보합·미확정 비율 */
  flatUnknownPct: number;
  /** 패 중 −3% 이하 비율 */
  bigLossSharePct: number | null;
  /** 최근 14일(일자 기준) 승률 */
  recentWinRatePct: number | null;
  recentDecided: number;
}

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
  metrics: SignalAnalysisMetrics;
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
const RECENT_DAYS = 14;
const HIGH_SCORE = 7;
const LOW_SCORE = 4;
const BIG_LOSS_PCT = -3;

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

function avgChange(items: RecommendationTrackerItem[]): number | null {
  const pcts = items
    .map((it) => it.changePct)
    .filter((p): p is number => p != null && Number.isFinite(p));
  if (!pcts.length) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

function avgOutcomeChange(
  items: RecommendationTrackerItem[],
  outcome: "win" | "loss",
): number | null {
  const pcts = items
    .filter((it) => it.outcome === outcome && it.changePct != null && Number.isFinite(it.changePct))
    .map((it) => it.changePct as number);
  if (!pcts.length) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

function avgScore(items: RecommendationTrackerItem[]): number | null {
  const scores = items
    .map((it) => it.score)
    .filter((s): s is number => s != null && Number.isFinite(s));
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function topCoSignals(
  items: RecommendationTrackerItem[],
  signalId: SignalId,
  limit = 3,
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

function recentCutoffDate(pool: RecommendationTrackerItem[]): string | null {
  const dates = [...new Set(pool.map((it) => it.date).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a),
  );
  if (!dates.length) return null;
  const latest = dates[0];
  const d = new Date(`${latest}T12:00:00`);
  if (Number.isNaN(d.getTime())) return latest;
  d.setDate(d.getDate() - RECENT_DAYS);
  return d.toISOString().slice(0, 10);
}

function computeMetrics(
  pool: RecommendationTrackerItem[],
  withSignal: RecommendationTrackerItem[],
): SignalAnalysisMetrics {
  const solo = withSignal.filter((it) => it.signalIds.length === 1);
  const multi = withSignal.filter((it) => it.signalIds.length > 1);
  const soloR = winRateFromItems(solo);
  const multiR = winRateFromItems(multi);
  const high = withSignal.filter((it) => it.score != null && it.score >= HIGH_SCORE);
  const low = withSignal.filter(
    (it) => it.score != null && it.score <= LOW_SCORE && Number.isFinite(it.score),
  );
  const highR = winRateFromItems(high);
  const lowR = winRateFromItems(low);
  const kr = withSignal.filter((it) => it.market === "kr");
  const us = withSignal.filter((it) => it.market === "us");
  const krR = winRateFromItems(kr);
  const usR = winRateFromItems(us);

  const decidedItems = withSignal.filter(
    (it) => it.outcome === "win" || it.outcome === "loss",
  );
  const avgWin = avgOutcomeChange(withSignal, "win");
  const avgLoss = avgOutcomeChange(withSignal, "loss");
  const wr = winRateFromItems(withSignal);
  let expectancyPct: number | null = null;
  if (wr.winRatePct != null && avgWin != null && avgLoss != null) {
    const lossRate = 1 - wr.winRatePct / 100;
    expectancyPct = (wr.winRatePct / 100) * avgWin + lossRate * avgLoss;
  }

  const losses = withSignal.filter((it) => it.outcome === "loss");
  const bigLosses = losses.filter(
    (it) => it.changePct != null && it.changePct <= BIG_LOSS_PCT,
  );
  const bigLossSharePct =
    losses.length > 0 ? (bigLosses.length / losses.length) * 100 : null;

  const flatUnknown = withSignal.filter(
    (it) => it.outcome === "flat" || it.outcome === "unknown",
  ).length;

  const cutoff = recentCutoffDate(pool);
  const recent = cutoff
    ? withSignal.filter((it) => it.date >= cutoff)
    : [];
  const recentR = winRateFromItems(recent);

  const coCounts = withSignal.map((it) => it.signalIds.length);
  const avgCoSignalCount =
    coCounts.length > 0
      ? coCounts.reduce((a, b) => a + b, 0) / coCounts.length
      : 0;

  return {
    poolSharePct: pool.length > 0 ? (withSignal.length / pool.length) * 100 : 0,
    avgChangePct: avgChange(decidedItems),
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    expectancyPct,
    avgCoSignalCount,
    soloWinRatePct: soloR.winRatePct,
    soloDecided: soloR.decided,
    multiWinRatePct: multiR.winRatePct,
    multiDecided: multiR.decided,
    highScoreWinRatePct: highR.winRatePct,
    highScoreDecided: highR.decided,
    lowScoreWinRatePct: lowR.winRatePct,
    lowScoreDecided: lowR.decided,
    krWinRatePct: krR.winRatePct,
    krDecided: krR.decided,
    usWinRatePct: usR.winRatePct,
    usDecided: usR.decided,
    flatUnknownPct: withSignal.length > 0 ? (flatUnknown / withSignal.length) * 100 : 0,
    bigLossSharePct,
    recentWinRatePct: recentR.winRatePct,
    recentDecided: recentR.decided,
  };
}

function buildBullets(
  signalId: SignalId,
  baselinePct: number,
  stat: { winRatePct: number; decided: number },
  m: SignalAnalysisMetrics,
  withSignal: RecommendationTrackerItem[],
): string[] {
  const bullets: string[] = [];
  const delta = stat.winRatePct - baselinePct;
  bullets.push(
    `전체 승률 ${baselinePct.toFixed(1)}% 대비 ${Math.abs(delta).toFixed(1)}%p 낮습니다.`,
  );

  if (stat.decided < 15) {
    bullets.push(`승패 확정 ${stat.decided}건 — 표본이 적어 해석은 참고용입니다.`);
  }

  bullets.push(`추천의 ${m.poolSharePct.toFixed(0)}%에 이 근거가 포함됩니다.`);

  if (m.expectancyPct != null) {
    bullets.push(
      `승패 확정 건 기대 등락 약 ${m.expectancyPct >= 0 ? "+" : ""}${m.expectancyPct.toFixed(2)}%.`,
    );
  }

  if (m.avgWinPct != null && m.avgLossPct != null) {
    bullets.push(
      `평균 승리 ${m.avgWinPct >= 0 ? "+" : ""}${m.avgWinPct.toFixed(2)}% · 평균 패배 ${m.avgLossPct.toFixed(2)}%.`,
    );
  }

  if (
    m.soloDecided >= 4 &&
    m.multiDecided >= 4 &&
    m.soloWinRatePct != null &&
    m.multiWinRatePct != null
  ) {
    if (m.soloWinRatePct < baselinePct - 3 && m.multiWinRatePct < baselinePct - 3) {
      bullets.push(
        `단독 ${m.soloWinRatePct.toFixed(1)}%(${m.soloDecided}건)·복합 ${m.multiWinRatePct.toFixed(1)}%(${m.multiDecided}건) 모두 낮습니다.`,
      );
    } else if (m.multiWinRatePct < m.soloWinRatePct - 8) {
      bullets.push(
        `단독 ${m.soloWinRatePct.toFixed(1)}%보다 복합 ${m.multiWinRatePct.toFixed(1)}%가 더 낮습니다 — 조합 주의.`,
      );
    }
  }

  if (m.highScoreDecided >= 4 && m.lowScoreDecided >= 4) {
    if (m.highScoreWinRatePct != null && m.lowScoreWinRatePct != null) {
      if (m.lowScoreWinRatePct < m.highScoreWinRatePct - 10) {
        bullets.push(
          `저점수(≤${LOW_SCORE}점) ${m.lowScoreWinRatePct.toFixed(1)}% vs 고점수(≥${HIGH_SCORE}점) ${m.highScoreWinRatePct.toFixed(1)}%.`,
        );
      }
    }
  } else {
    const avg = avgScore(withSignal);
    if (avg != null && avg < 5) {
      bullets.push(`평균 점수 ${avg.toFixed(1)}점 — 낮은 점수 추천에 자주 포함.`);
    } else if (avg != null && avg >= 7) {
      bullets.push(`평균 ${avg.toFixed(1)}점인데 승률이 낮아 시장·타이밍 이슈를 의심.`);
    }
  }

  if (
    m.krDecided >= 4 &&
    m.usDecided >= 4 &&
    m.krWinRatePct != null &&
    m.usWinRatePct != null &&
    Math.abs(m.krWinRatePct - m.usWinRatePct) >= 12
  ) {
    bullets.push(`국내 ${m.krWinRatePct.toFixed(1)}%(${m.krDecided}) · 미국 ${m.usWinRatePct.toFixed(1)}%(${m.usDecided}).`);
  }

  if (m.bigLossSharePct != null && m.bigLossSharePct >= 35) {
    bullets.push(`패의 ${m.bigLossSharePct.toFixed(0)}%가 ${BIG_LOSS_PCT}% 이하 — 손실 꼬리가 큼.`);
  }

  if (m.recentDecided >= 4 && m.recentWinRatePct != null) {
    const recentDelta = m.recentWinRatePct - stat.winRatePct;
    if (Math.abs(recentDelta) >= 8) {
      bullets.push(
        `최근 ${RECENT_DAYS}일 승률 ${m.recentWinRatePct.toFixed(1)}%(${m.recentDecided}건) — 전체와 ${recentDelta > 0 ? "+" : ""}${recentDelta.toFixed(0)}%p 차이.`,
      );
    }
  }

  if (m.flatUnknownPct >= 8) {
    bullets.push(`보합·미확정 ${m.flatUnknownPct.toFixed(0)}% — 아직 결론 안 난 비중이 큼.`);
  }

  if (m.avgCoSignalCount >= 4.5) {
    bullets.push(`평균 ${m.avgCoSignalCount.toFixed(1)}개 근거와 동시 충족 — 단일 조건 효과가 희석될 수 있음.`);
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
    bullets.push(`동반 근거: ${parts}.`);
  }

  const hint = SIGNAL_CONTEXT_HINT[signalId];
  if (hint) bullets.push(hint);

  return bullets.slice(0, 8);
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
    const metrics = computeMetrics(pool, group);
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
      metrics,
      bullets: buildBullets(signalId, baselinePct, { winRatePct, decided }, metrics, group),
      severity: delta <= -15 ? "low" : "watch",
    });
  }

  candidates.sort((a, b) => a.winRatePct - b.winRatePct);

  return {
    baseline,
    insights: candidates.slice(0, MAX_INSIGHTS),
  };
}
