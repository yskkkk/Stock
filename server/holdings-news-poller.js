/**
 * 보유 종목 속보 이메일 폴러
 */
import {
  holdingsBreakingNewsEmailEnabled,
  tickHoldingsBreakingNewsEmail,
} from "./notifications/holdings-breaking-news-email.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_HOLDINGS_NEWS_POLL_MS ?? 45_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(n, 300_000) : 45_000;
})();

let running = false;

export function getHoldingsNewsPollIntervalMs() {
  return POLL_MS;
}

export async function tickHoldingsNewsPollerOnce() {
  if (!holdingsBreakingNewsEmailEnabled()) {
    return { ok: false, reason: "disabled" };
  }
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync("holdings-news", async () => {
    running = true;
    try {
      return await tickHoldingsBreakingNewsEmail();
    } finally {
      running = false;
    }
  });
}

export function startHoldingsNewsEmailPoller() {
  if (!holdingsBreakingNewsEmailEnabled()) {
    liveTradeLogInfo(
      "[holdings-news] poller off — set STOCK_HOLDINGS_NEWS_EMAIL=1 to enable",
    );
    return;
  }

  liveTradeLogInfo("[holdings-news] poller on", `intervalMs=${POLL_MS}`);

  markPollerBootStarted("holdings-news");

  const run = () => {
    void tickHoldingsNewsPollerOnce().catch((e) => {
      liveTradeLogWarn(
        "[holdings-news] tick failed",
        e instanceof Error ? e.message : e,
      );
    });
  };

  setTimeout(run, 8_000);
  setInterval(run, POLL_MS);
}
