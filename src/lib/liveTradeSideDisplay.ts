import { ko } from "../i18n/ko";
import type { LiveTradeRecord } from "../api";

/** 체결 구분 — «매수 (프로그램)», «매도 (거래소)» 등 */
export function formatTradeSideLabel(
  t: Pick<LiveTradeRecord, "side" | "simulated" | "exchangeImport">,
): string {
  const action =
    t.side === "buy" ? ko.app.liveTradeSideBuy : ko.app.liveTradeSideSell;
  const source = t.exchangeImport
    ? ko.app.liveTradeExchangeTag
    : t.simulated
      ? ko.app.liveTradeSideSourceSim
      : ko.app.liveTradeSideSourceProgram;
  return `${action} (${source})`;
}
