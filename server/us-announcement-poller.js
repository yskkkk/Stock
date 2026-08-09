/**
 * 미국 발표 인박스 폴러
 */
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import { tickUsAnnouncementInbox } from "./us-announcement-tick.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_US_ANNOUNCEMENT_POLL_MS ?? 180_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 900_000) : 180_000;
})();

let running = false;

export function usAnnouncementPollerEnabled() {
  return String(process.env.STOCK_US_ANNOUNCEMENT_POLL ?? "1").trim() !== "0";
}

export function getUsAnnouncementPollIntervalMs() {
  return POLL_MS;
}

export async function tickUsAnnouncementPollerOnce() {
  if (!usAnnouncementPollerEnabled()) {
    return { ok: false, reason: "disabled" };
  }
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync("us-announcement-inbox", async () => {
    running = true;
    try {
      return await tickUsAnnouncementInbox({ notify: true });
    } finally {
      running = false;
    }
  });
}

export function startUsAnnouncementInboxPoller() {
  if (!usAnnouncementPollerEnabled()) {
    liveTradeLogInfo(
      "[us-announcement] poller off (STOCK_US_ANNOUNCEMENT_POLL=0)",
    );
    return;
  }

  liveTradeLogInfo("[us-announcement] poller on", `intervalMs=${POLL_MS}`);
  markPollerBootStarted("us-announcement-inbox");

  const run = () => {
    void tickUsAnnouncementPollerOnce().catch((e) => {
      liveTradeLogWarn(
        "[us-announcement] tick failed",
        e instanceof Error ? e.message : e,
      );
    });
  };

  setTimeout(run, 20_000);
  setInterval(run, POLL_MS);
}
