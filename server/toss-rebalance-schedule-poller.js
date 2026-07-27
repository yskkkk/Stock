/**
 * 토스 월별 비중 유지 매수 스케줄 폴러
 */
import { listTossReadyUserIdsSync } from "./user-credentials-store.js";
import {
  getTossRebalanceScheduleSync,
  listTossRebalanceScheduleUserIdsSync,
} from "./toss-rebalance-schedule-store.js";
import {
  kstDayOfMonth,
  kstYmd,
  runTossRebalanceScheduleForUser,
} from "./toss-rebalance-schedule.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_TOSS_REBALANCE_POLL_MS ?? 15 * 60_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 60 * 60_000) : 15 * 60_000;
})();

let running = false;

export function getTossRebalanceSchedulePollIntervalMs() {
  return POLL_MS;
}

export async function tickTossRebalanceScheduleOnce() {
  if (running) return { ok: false, reason: "busy" };
  return pollerGuardAsync("toss-rebalance-schedule", async () => {
    running = true;
    try {
      const today = kstYmd();
      const day = kstDayOfMonth();
      const scheduled = new Set(listTossRebalanceScheduleUserIdsSync());
      const ready = listTossReadyUserIdsSync();
      /** @type {Array<object>} */
      const results = [];
      for (const uid of ready) {
        if (!scheduled.has(uid)) continue;
        const sched = getTossRebalanceScheduleSync(uid);
        if (!sched?.enabled) continue;
        if (sched.dayOfMonth !== day) continue;
        if (sched.lastRunYmd === today) continue;
        try {
          const r = await runTossRebalanceScheduleForUser(uid, { force: false });
          results.push({ userId: uid, ...r });
        } catch (e) {
          liveTradeLogWarn(
            "[toss-rebalance] user tick failed",
            uid,
            e instanceof Error ? e.message : e,
          );
          results.push({
            userId: uid,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return { ok: true, today, day, ran: results.length, results };
    } finally {
      running = false;
    }
  });
}

export function startTossRebalanceSchedulePoller() {
  if (process.env.STOCK_TOSS_REBALANCE_POLL === "0") {
    liveTradeLogInfo("[toss-rebalance] poller off (STOCK_TOSS_REBALANCE_POLL=0)");
    return;
  }

  liveTradeLogInfo("[toss-rebalance] poller on", `intervalMs=${POLL_MS}`);
  markPollerBootStarted("toss-rebalance-schedule");

  const run = () => {
    void tickTossRebalanceScheduleOnce().catch((e) => {
      liveTradeLogWarn(
        "[toss-rebalance] tick failed",
        e instanceof Error ? e.message : e,
      );
    });
  };

  setTimeout(run, 20_000);
  setInterval(run, POLL_MS);
}
