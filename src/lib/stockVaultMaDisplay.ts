import type { GoldenCrossKind, StockVaultChartInsightSnapshot, StockVaultItem } from "../types";

const CROSS_LABEL: Record<GoldenCrossKind, string> = {
  "5>20": "5→20 골든",
  "5<20": "5→20 데드",
  "20>120": "20→120 골든",
  "20<120": "20→120 데드",
  "5>60": "5→60 골든",
  "5>120": "5→120 골든",
};

const CROSS_DISPLAY_ORDER: GoldenCrossKind[] = [
  "5>20",
  "5<20",
  "5>60",
  "5>120",
  "20>120",
  "20<120",
];

/** MA 교차 — Pine(5↔20·20↔120) + 5→60·120 골든 */
export function formatGoldenCrossChain(
  crosses: GoldenCrossKind[] | undefined,
): string | null {
  if (!crosses?.length) return null;
  const set = new Set(crosses);
  const labels = CROSS_DISPLAY_ORDER.filter((c) => set.has(c)).map(
    (c) => CROSS_LABEL[c],
  );
  return labels.length ? labels.join(" · ") : null;
}

/** 정배열 — 탐지 조건(5>20>60>120)과 동일한 표기 */
export function formatMaAlignChain(): string {
  return "5>20>60>120";
}

/** 일봉 120선 근처 — 스캔 결과 배지 */
export function formatMa120NearLabel(
  distancePct?: number | null,
  approach?: "from_below" | "from_above" | "flat" | null,
  labels?: { fromBelow: string; fromAbove: string },
): string {
  const dist =
    distancePct == null || !Number.isFinite(distancePct)
      ? "±3%"
      : `±${distancePct.toFixed(1)}%`;
  if (approach === "from_below") {
    return `120선 ${dist} · ${labels?.fromBelow ?? "하단접근"}`;
  }
  if (approach === "from_above") {
    return `120선 ${dist} · ${labels?.fromAbove ?? "상단접근"}`;
  }
  return `120선 ${dist}`;
}

export function ma120ApproachResolvableWithoutQuote(
  item: Pick<
    StockVaultItem,
    "ma120Approach" | "ma120Side" | "source" | "symbol"
  >,
  insight?: StockVaultChartInsightSnapshot | null,
): boolean {
  if (item.source !== "ma120_near") return true;
  if (item.ma120Approach === "from_below" || item.ma120Approach === "from_above") {
    return true;
  }
  if (item.ma120Side === "below" || item.ma120Side === "above") {
    return true;
  }
  const hit = insight?.daily?.near?.find((n) => n.period === 120);
  if (hit?.approach === "from_below" || hit?.approach === "from_above") {
    return true;
  }
  if (hit?.side === "below" || hit?.side === "above") {
    return true;
  }
  return false;
}

export function listMa120SymbolsNeedingQuotes(
  items: StockVaultItem[],
  quotes: Record<string, { price?: number } | undefined>,
  chartInsights: Record<string, StockVaultChartInsightSnapshot | undefined>,
): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.source !== "ma120_near") continue;
    const sym = it.symbol.trim().toUpperCase();
    const insight = chartInsights[sym];
    if (ma120ApproachResolvableWithoutQuote(it, insight)) continue;
    const ma120 = Number(it.ma120);
    const price = Number(quotes[sym]?.price);
    if (Number.isFinite(ma120) && ma120 > 0 && Number.isFinite(price) && price > 0) {
      continue;
    }
    out.push(sym);
  }
  return [...new Set(out)];
}

export function enrichMa120ItemSide(
  item: StockVaultItem,
  currentPrice?: number | null,
): StockVaultItem {
  if (item.source !== "ma120_near") return item;
  if (item.ma120Side === "above" || item.ma120Side === "below") return item;
  if (item.ma120Approach === "from_below") {
    return { ...item, ma120Side: "below" };
  }
  if (item.ma120Approach === "from_above") {
    return { ...item, ma120Side: "above" };
  }
  const ma120 = Number(item.ma120);
  const price = Number(currentPrice);
  if (Number.isFinite(ma120) && ma120 > 0 && Number.isFinite(price) && price > 0) {
    return { ...item, ma120Side: price >= ma120 ? "above" : "below" };
  }
  return item;
}

export function resolveMa120Approach(
  item: {
    ma120Approach?: "from_below" | "from_above" | "flat";
    ma120Side?: "above" | "below";
    ma120?: number | null;
  },
  insight?: {
    daily?: {
      near?: Array<{ period: number; approach?: string; side?: string }>;
    };
  } | null,
  currentPrice?: number | null,
): "from_below" | "from_above" | "flat" {
  if (item.ma120Approach === "from_below" || item.ma120Approach === "from_above") {
    return item.ma120Approach;
  }
  if (item.ma120Side === "below") return "from_below";
  if (item.ma120Side === "above") return "from_above";

  const hit = insight?.daily?.near?.find((n) => n.period === 120);
  if (hit?.approach === "from_below" || hit?.approach === "from_above") {
    return hit.approach;
  }
  if (hit?.side === "below") return "from_below";
  if (hit?.side === "above") return "from_above";

  const ma120 = Number(item.ma120);
  const price = Number(currentPrice);
  if (Number.isFinite(ma120) && ma120 > 0 && Number.isFinite(price) && price > 0) {
    if (price < ma120) return "from_below";
    if (price > ma120) return "from_above";
  }
  return "flat";
}
