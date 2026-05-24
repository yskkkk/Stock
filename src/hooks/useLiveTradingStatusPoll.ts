import { useEffect, useState } from "react";
import {
  fetchLiveTradingStatus,
  type LiveTradingStatusResponse,
} from "../api";
import { writeLiveTradingHeaderSnapshot } from "../lib/liveTradingHeaderSnapshot";
import { invalidateLiveTradingPrefetch, peekLiveTradingPrefetch } from "../lib/tabPrefetch";

const POLL_MS = 22_000;

let sharedStatus: LiveTradingStatusResponse | null = null;
let pollStarted = false;
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

function pollTick() {
  void fetchLiveTradingStatus()
    .then(notify)
    .catch(() => {
      /* ignore — 로그인 전·일시 오류 */
    });
}

function ensurePoll() {
  if (pollStarted) return;
  pollStarted = true;
  window.setInterval(pollTick, POLL_MS);
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
    ensurePoll();
    void refreshLiveTradingStatusNow();
    const onUpdate = (next: LiveTradingStatusResponse | null) => setStatus(next);
    listeners.add(onUpdate);
    if (sharedStatus) setStatus(sharedStatus);
    return () => {
      listeners.delete(onUpdate);
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
