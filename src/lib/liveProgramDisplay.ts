import type { LiveTradeArmLane, LiveTradeProgram } from "../api";

/** 보유 중인 시뮬 프로그램은 error 배지·문구 대신 sim으로 표시 */
export function programDisplayStatus(
  p: LiveTradeProgram,
  holdingCount: number,
): LiveTradeProgram["status"] {
  if (p.status === "error" && holdingCount > 0) return "sim";
  return p.status;
}

/** 중지·등록 상태 — «실매매 시작» 채널(armedMarkets 잔존값은 무시) */
export function liveArmLaneForProgramStart(
  p: LiveTradeProgram,
): LiveTradeArmLane | null {
  if (p.status === "sim" || p.status === "armed") return null;
  if (p.markets.crypto) return "bithumb";
  if (p.markets.kr && !p.markets.us) return "toss";
  return null;
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
