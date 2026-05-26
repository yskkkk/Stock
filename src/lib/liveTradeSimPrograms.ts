import type { LiveTradeProgram } from "../api";

/** 거래내역·시뮬 피커 — 실행 중 시뮬만 */
export function filterSimPrograms(
  programs: LiveTradeProgram[] | null | undefined,
): LiveTradeProgram[] {
  return (programs ?? []).filter((p) => p.status === "sim");
}
