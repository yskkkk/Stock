/**
 * 장 마감 보유 종목 브리핑 폴러 — KR 15:40 KST · US 16:10 ET 이후 세션당 1회
 */
import {
  holdingsCloseDigestEnabled,
  tickHoldingsCloseDigestEmail,
} from "./notifications/holdings-close-digest-email.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_HOLDINGS_CLOSE_DIGEST_POLL_MS ?? 120_000);
  return Number.isFinite(n) && n >= 30_000 ? Math.min(n, 900_000) : 120_000;
})();

let running = false;

export function getHoldingsCloseDigestPollIntervalMs() {
  return POLL_MS;
}

export async function tickHoldingsCloseDigestPollerOnce() {
  if (!holdingsCloseDigestEnabled()) {
    return { ok: false, reason: "disabled" };
  }
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync("holdings-close-digest", async () => {
    running = true;
    try {
      return await tickHoldingsCloseDigestEmail();
    } finally {
      running = false;
    }
  });
}

export function startHoldingsCloseDigestPoller() {
  if (!holdingsCloseDigestEnabled()) {
    liveTradeLogInfo(
      "[holdings-close-digest] poller off — set STOCK_HOLDINGS_CLOSE_DIGEST=1",
    );
    return;
  }

  liveTradeLogInfo("[holdings-close-digest] poller on", `intervalMs=${POLL_MS}`);
  markPollerBootStarted("holdings-close-digest");

  const run = () => {
    void tickHoldingsCloseDigestPollerOnce().catch((e) => {
      liveTradeLogWarn(
        "[holdings-close-digest] tick failed",
        e instanceof Error ? e.message : e,
      );
    });
  };

  setTimeout(run, 20_000);
  setInterval(run, POLL_MS);
}
