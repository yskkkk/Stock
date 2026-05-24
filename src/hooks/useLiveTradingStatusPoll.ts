import { useEffect, useState } from "react";
import { fetchAuthMe, fetchLiveTradingStatus, type LiveTradingStatusResponse } from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";
import { writeLiveTradingHeaderSnapshot } from "../lib/liveTradingHeaderSnapshot";
import { invalidateLiveTradingPrefetch, peekLiveTradingPrefetch } from "../lib/tabPrefetch";

const POLL_MS = 22_000;

let sharedStatus: LiveTradingStatusResponse | null = null;
let pollStarted = false;
let pollIntervalId: number | null = null;
const listeners = new Set<(status: LiveTradingStatusResponse | null) => void>();

function notify(status: LiveTradingStatusResponse | null) {
  sharedStatus = status;
  if (status) {
    writeLiveTradingHeaderSnapshot({
      programs: status.programs ?? [],
      armedCount: status.armedCount ?? 0,
      simCount: status.simCount ?? 0,
    });
  }
  for (const fn of listeners) fn(status);
}

function clearLiveTradingStatus() {
  sharedStatus = null;
  invalidateLiveTradingPrefetch();
  notify(null);
}

function pollTick() {
  void fetchLiveTradingStatus()
    .then(notify)
    .catch(() => {
      void fetchAuthMe()
        .then((me) => {
          if (!me.user) clearLiveTradingStatus();
        })
        .catch(() => {
          clearLiveTradingStatus();
        });
    });
}

function ensurePoll() {
  if (pollStarted) return;
  pollStarted = true;
  pollIntervalId = window.setInterval(pollTick, POLL_MS);
}

/** 로그인·로그아웃 직후 — 캐시 무효화 후 즉시 재조회 */
export function refreshLiveTradingStatusNow(): void {
  invalidateLiveTradingPrefetch();
  pollTick();
}

/** 실매매 상태 — 앱 전역 단일 폴링(헤더·좌측 레일 공유) */
export function useLiveTradingStatusPoll(): LiveTradingStatusResponse | null {
  const prefetched = peekLiveTradingPrefetch();
  const [status, setStatus] = useState<LiveTradingStatusResponse | null>(
    sharedStatus ?? prefetched?.status ?? null,
  );

  useEffect(() => {
    const isFirstMount = !pollStarted;
    ensurePoll();
    if (isFirstMount) void refreshLiveTradingStatusNow();
    const onUpdate = (next: LiveTradingStatusResponse | null) => setStatus(next);
    listeners.add(onUpdate);
    if (sharedStatus) setStatus(sharedStatus);
    const onAuthChange = () => {
      void fetchAuthMe()
        .then((me) => {
          if (!me.user) clearLiveTradingStatus();
          else pollTick();
        })
        .catch(() => {
          clearLiveTradingStatus();
        });
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      listeners.delete(onUpdate);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    };
  }, []);

  return status;
}

export function pickRunningLivePrograms(
  status: LiveTradingStatusResponse | null,
): Array<{ program: LiveTradingStatusResponse["programs"][number]; kind: "armed" | "sim" }> {
  const programs = status?.programs ?? [];
  const armed = programs
    .filter((p) => p.status === "armed")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const sim = programs
    .filter((p) => p.status === "sim")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return [
    ...armed.map((program) => ({ program, kind: "armed" as const })),
    ...sim.map((program) => ({ program, kind: "sim" as const })),
  ];
}
