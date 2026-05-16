import type { StockPick } from "../types";

export type SortKey = "score" | "change" | "name";

export function sortPicksList(
  picks: StockPick[],
  key: SortKey,
  desc = true,
): StockPick[] {
  const sorted = [...picks];
  const mul = desc ? -1 : 1;

  sorted.sort((a, b) => {
    if (key === "score") {
      return mul * (a.score - b.score) || mul * ((a.changePercent ?? 0) - (b.changePercent ?? 0));
    }
    if (key === "change") {
      return mul * ((a.changePercent ?? 0) - (b.changePercent ?? 0)) || mul * (a.score - b.score);
    }
    return mul * a.name.localeCompare(b.name, "ko");
  });

  return sorted;
}
