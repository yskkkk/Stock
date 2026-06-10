import type { GoldenCrossKind } from "../types";

const GOLDEN_CROSS_SLOW_ORDER: GoldenCrossKind[] = ["5>20", "5>60", "5>120"];

/** 골든크로스 — 실제 발생한 slow MA만 5→20→60→120 순 체인 */
export function formatGoldenCrossChain(
  crosses: GoldenCrossKind[] | undefined,
): string | null {
  if (!crosses?.length) return null;
  const set = new Set(crosses);
  const periods = GOLDEN_CROSS_SLOW_ORDER.filter((c) => set.has(c)).map(
    (c) => c.split(">")[1]!,
  );
  if (!periods.length) return null;
  return `5→${periods.join("→")}`;
}

/** 정배열 — 탐지 조건(5>20>60>120)과 동일한 표기 */
export function formatMaAlignChain(): string {
  return "5>20>60>120";
}
