import { krInvestorFlowEnabled, runKrInvestorFlowScan } from "./kr-investor-flow.js";
import { liveTradeLogWarn } from "./live-trade-log.js";

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
    if (running) return;
    running = true;
    void runKrInvestorFlowScan()
      .catch((e) => {
        liveTradeLogWarn(
          "[kr-investor-flow:poller]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  setInterval(tick, POLL_MS);
}
