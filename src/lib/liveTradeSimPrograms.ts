import type { LiveTradeProgram } from "../api";

export type SimProgramLike = Pick<LiveTradeProgram, "id" | "name"> & {
  status?: LiveTradeProgram["status"];
};

/** 거래내역·시뮬 피커 — 실행 중 시뮬만 */
export function filterSimPrograms(
  programs: SimProgramLike[] | null | undefined,
): SimProgramLike[] {
  return (programs ?? []).filter((p) => p.status == null || p.status === "sim");
}
