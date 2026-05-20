import type { RecommendationOutcome, RecommendationTrackerItem } from "../types";

export type RecTrackerSortKey =
  | "date"
  | "name"
  | "score"
  | "entry"
  | "current"
  | "change"
  | "outcome";

export type SortDir = "asc" | "desc";

const OUTCOME_RANK: Record<RecommendationOutcome, number> = {
  win: 3,
  loss: 1,
  flat: 2,
  unknown: 0,
};

/** 승률 칩·통계: 높은 승률이 왼쪽(내림차순). 동률이면 표본 수 많은 순. */
export function compareWinRateDesc(
  a: { winRatePct: number | null; total?: number },
  b: { winRatePct: number | null; total?: number },
): number {
  const ar = a.winRatePct;
  const br = b.winRatePct;
  if (ar == null && br == null) {
    return (b.total ?? 0) - (a.total ?? 0);
  }
  if (ar == null) return 1;
  if (br == null) return -1;
  if (br !== ar) return br - ar;
  return (b.total ?? 0) - (a.total ?? 0);
}

function compareNullableNum(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return mul * (a - b);
}

/**
 * @param {RecommendationTrackerItem[]} items
 * @param {RecTrackerSortKey} key
 * @param {SortDir} dir
 */
export function sortRecTrackerItems(
  items: RecommendationTrackerItem[],
  key: RecTrackerSortKey,
  dir: SortDir,
): RecommendationTrackerItem[] {
  const sorted = [...items];
  const mul = dir === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "date":
        cmp = mul * b.date.localeCompare(a.date);
        break;
      case "name":
        cmp = mul * a.name.localeCompare(b.name, "ko");
        break;
      case "score":
        cmp = compareNullableNum(a.score, b.score, dir);
        break;
      case "entry":
        cmp = compareNullableNum(a.entryPrice, b.entryPrice, dir);
        break;
      case "current":
        cmp = compareNullableNum(a.currentPrice, b.currentPrice, dir);
        break;
      case "change":
        cmp = compareNullableNum(a.changePct, b.changePct, dir);
        break;
      case "outcome":
        cmp = mul * (OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome]);
        break;
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp;
    return b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol, "ko");
  });

  return sorted;
}
