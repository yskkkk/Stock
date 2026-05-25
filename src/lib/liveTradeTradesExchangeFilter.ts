import type { LiveTradeRecord } from "../api";
import type { LiveTradeTradesExchange } from "./liveTradeTradesWorkspace";

export function liveTradeRecordMatchesExchange(
  t: LiveTradeRecord,
  exchange: LiveTradeTradesExchange,
): boolean {
  if (exchange === "bithumb") return t.market === "crypto";
  return t.market === "kr" || t.market === "us";
}
