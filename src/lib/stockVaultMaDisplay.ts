import type { GoldenCrossKind } from "../types";

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
