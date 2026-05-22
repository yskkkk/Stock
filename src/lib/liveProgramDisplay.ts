import type { LiveTradeProgram } from "../api";

/** 보유 중인 시뮬 프로그램은 error 배지·문구 대신 sim으로 표시 */
export function programDisplayStatus(
  p: LiveTradeProgram,
  holdingCount: number,
): LiveTradeProgram["status"] {
  if (p.status === "error" && holdingCount > 0) return "sim";
  return p.status;
}

export function showProgramRunError(
  p: LiveTradeProgram,
  holdingCount: number,
): boolean {
  const err = p.lastError?.trim();
  if (!err) return false;
  if (holdingCount > 0 && programDisplayStatus(p, holdingCount) === "sim") {
    return false;
  }
  return true;
}
