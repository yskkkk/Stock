import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import { FILTER_OPTIONS } from "../constants/signals";
import type { RecommendationTrackerItem } from "../types";

export type TechUpgradeKind = "boost" | "cut";

export interface TechWeightChange {
  signalId: SignalId;
  label: string;
  short: string;
  from: number;
  to: number;
  winRatePct: number;
  decided: number;
  deltaVsBaseline: number;
  kind: TechUpgradeKind;
}

export interface TechUpgradePlan {
  baselineWinRatePct: number | null;
  baselineDecided: number;
  maxTechScore: number;
  changes: TechWeightChange[];
  headline: string | null;
}

const MIN_DECIDED = 5;
const BOOST_DELTA_PP = 4;
const CUT_DELTA_PP = 5;
const MIN_WEIGHT = 0;
const MAX_WEIGHT = 4;

function winRateFromItems(items: RecommendationTrackerItem[]) {
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

function sumWeights(weights: Record<string, number>): number {
  return Object.values(weights).reduce(
    (a, b) => a + (typeof b === "number" && Number.isFinite(b) ? b : 0),
    0,
  );
}

function changeReason(
  kind: TechUpgradeKind,
  delta: number,
  winRatePct: number,
  baselinePct: number,
): string {
  if (kind === "boost") {
    return `알림 종목 승률 ${winRatePct.toFixed(1)}% — 전체 ${baselinePct.toFixed(1)}%보다 +${delta.toFixed(1)}%p 높아 가중치를 올립니다.`;
  }
  return `알림 종목 승률 ${winRatePct.toFixed(1)}% — 전체 ${baselinePct.toFixed(1)}%보다 ${delta.toFixed(1)}%p 낮아 가중치를 내립니다.`;
}

/**
 * @param pool 텔레그램 알림 종목 풀(칩 통계와 동일)
 * @param currentWeights 서버 활성 가중치
 */
export function buildTechUpgradePlan(
  pool: RecommendationTrackerItem[],
  currentWeights: Record<string, number>,
): TechUpgradePlan {
  const baseline = winRateFromItems(pool);
  const baselinePct = baseline.winRatePct;
  const maxTechScore = sumWeights(currentWeights);

  if (baselinePct == null || baseline.decided < MIN_DECIDED) {
    return {
      baselineWinRatePct: baselinePct,
      baselineDecided: baseline.decided,
      maxTechScore,
      changes: [],
      headline: null,
    };
  }

  const bySignal = new Map<SignalId, RecommendationTrackerItem[]>();
  for (const it of pool) {
    for (const id of it.signalIds) {
      const sid = id as SignalId;
      if (!bySignal.has(sid)) bySignal.set(sid, []);
      bySignal.get(sid)!.push(it);
    }
  }

  const boosts: TechWeightChange[] = [];
  const cuts: TechWeightChange[] = [];

  for (const { id: signalId } of FILTER_OPTIONS) {
    const group = bySignal.get(signalId);
    if (!group?.length) continue;
    const { decided, winRatePct } = winRateFromItems(group);
    if (winRatePct == null || decided < MIN_DECIDED) continue;
    const delta = winRatePct - baselinePct;
    const from = currentWeights[signalId] ?? 0;
    const meta = signalChipMeta(signalId);

    if (delta >= BOOST_DELTA_PP && from < MAX_WEIGHT) {
      const to = Math.min(MAX_WEIGHT, from + 1);
      if (to !== from) {
        boosts.push({
          signalId,
          label: meta.label,
          short: meta.short,
          from,
          to,
          winRatePct,
          decided,
          deltaVsBaseline: delta,
          kind: "boost",
        });
      }
    } else if (delta <= -CUT_DELTA_PP && from > MIN_WEIGHT) {
      const to = Math.max(MIN_WEIGHT, from - 1);
      if (to !== from) {
        cuts.push({
          signalId,
          label: meta.label,
          short: meta.short,
          from,
          to,
          winRatePct,
          decided,
          deltaVsBaseline: delta,
          kind: "cut",
        });
      }
    }
  }

  boosts.sort((a, b) => b.deltaVsBaseline - a.deltaVsBaseline);
  cuts.sort((a, b) => a.deltaVsBaseline - b.deltaVsBaseline);
  const changes = [...boosts, ...cuts];

  const top = boosts[0] ?? cuts[0] ?? null;
  const headline = top
    ? `${top.short} ${top.from}→${top.to} · ${top.winRatePct.toFixed(1)}%`
    : null;

  return {
    baselineWinRatePct: baselinePct,
    baselineDecided: baseline.decided,
    maxTechScore,
    changes,
    headline,
  };
}

export function applySingleTechWeightChange(
  current: Record<string, number>,
  change: TechWeightChange,
): Record<string, number> {
  return { ...current, [change.signalId]: change.to };
}

export function applyAllTechWeightChanges(
  current: Record<string, number>,
  changes: TechWeightChange[],
): Record<string, number> {
  const next = { ...current };
  for (const c of changes) next[c.signalId] = c.to;
  return next;
}

export function changeSummaryLine(c: TechWeightChange, baselinePct: number): string {
  return changeReason(c.kind, Math.abs(c.deltaVsBaseline), c.winRatePct, baselinePct);
}
