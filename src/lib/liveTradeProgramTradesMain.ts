import type { LiveTradeProgram } from "../api";
import type { LiveTradeHistoryScenario } from "./liveTradeHistoryScenario";

export type LiveTradeProgramTradesMainDetail = {
  programId: string;
  programName: string;
  scenario: LiveTradeHistoryScenario;
};

export const LIVE_TRADE_PROGRAM_TRADES_MAIN_EVENT =
  "ystock-live-trade-program-trades-main";

const PENDING_KEY = "ystock-live-trade-program-trades-main";

export function historyScenarioForProgram(
  p: LiveTradeProgram,
): LiveTradeHistoryScenario {
  if (p.status === "sim") return "sim";
  const cryptoOnly = p.markets.crypto && !p.markets.kr && !p.markets.us;
  if (cryptoOnly) return "live-bithumb";
  if (p.markets.kr || p.markets.us) return "live-toss";
  if (p.markets.crypto) return "live-bithumb";
  return "sim";
}

export function setPendingLiveTradeProgramTradesMain(
  detail: LiveTradeProgramTradesMainDetail,
): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(detail));
  } catch {
    /* ignore */
  }
}

export function consumePendingLiveTradeProgramTradesMain(): LiveTradeProgramTradesMainDetail | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveTradeProgramTradesMainDetail;
    if (!parsed?.programId?.trim()) return null;
    return {
      programId: String(parsed.programId).trim(),
      programName: String(parsed.programName ?? "").trim() || parsed.programId,
      scenario: parsed.scenario ?? "sim",
    };
  } catch {
    return null;
  }
}

export function dispatchLiveTradeProgramTradesMain(
  detail: LiveTradeProgramTradesMainDetail,
): void {
  if (typeof window === "undefined") return;
  const normalized: LiveTradeProgramTradesMainDetail = {
    programId: String(detail.programId ?? "").trim(),
    programName:
      String(detail.programName ?? "").trim() ||
      String(detail.programId ?? "").trim(),
    scenario: detail.scenario ?? "sim",
  };
  if (!normalized.programId) return;
  setPendingLiveTradeProgramTradesMain(normalized);
  window.dispatchEvent(
    new CustomEvent<LiveTradeProgramTradesMainDetail>(
      LIVE_TRADE_PROGRAM_TRADES_MAIN_EVENT,
      { detail: normalized },
    ),
  );
}

export function readLiveTradeProgramTradesMainEvent(
  e: Event,
): LiveTradeProgramTradesMainDetail | undefined {
  return (e as CustomEvent<LiveTradeProgramTradesMainDetail>).detail;
}
