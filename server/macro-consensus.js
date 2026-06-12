import { enrichMacroEventsWithFinnhubConsensus } from "./macro-consensus-finhub.js";
import { enrichMacroEventsWithFfConsensus } from "./macro-consensus-ff.js";

/**
 * @param {Array<{ code: string; region: string; at: number; forecast?: string | null }>} events
 */
export async function enrichMacroEventsConsensus(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  await enrichMacroEventsWithFinnhubConsensus(events).catch(() => {});
  await enrichMacroEventsWithFfConsensus(events).catch(() => {});
}
