import { krInvestorFlowEnabled, runKrInvestorFlowScan } from "./kr-investor-flow.js";
import { liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_KR_INVESTOR_FLOW_POLL_MS ?? 600_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 3_600_000) : 600_000;
})();

export function startKrInvestorFlowPoller() {
  if (!krInvestorFlowEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockKrInvestorFlow?: boolean }} */ (
    globalThis
  );
  if (g.__stockKrInvestorFlow) return;
  g.__stockKrInvestorFlow = true;

  let running = false;
  const tick = () => {
    try {
      if (running) return;
      running = true;
      void pollerGuardAsync("kr-investor-flow", () => runKrInvestorFlowScan())
        .catch((e) => {
          liveTradeLogWarn(
            "[kr-investor-flow:poller]",
            e instanceof Error ? e.message : e,
          );
        })
        .finally(() => {
          running = false;
        });
    } catch (e) {
      running = false;
      liveTradeLogWarn(
        "[kr-investor-flow:poller:tick]",
        e instanceof Error ? e.message : e,
      );
    }
  };

  tick();
  markPollerBootStarted("kr-investor-flow");
  setInterval(tick, POLL_MS);
}
