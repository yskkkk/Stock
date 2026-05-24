import { useEffect, useState } from "react";
import {
  fetchLiveTradingStatus,
  type LiveTradingStatusResponse,
} from "../api";
import { writeLiveTradingHeaderSnapshot } from "../lib/liveTradingHeaderSnapshot";
import { peekLiveTradingPrefetch } from "../lib/tabPrefetch";

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

function ensurePoll() {
  if (pollStarted) return;
  pollStarted = true;
  const tick = async () => {
    try {
      const next = await fetchLiveTradingStatus();
      notify(next);
    } catch {
      /* ignore — 로그인 전·일시 오류 */
    }
  };
  void tick();
  window.setInterval(() => void tick(), POLL_MS);
}

/** 실매매 상태 — 앱 전역 단일 폴링(헤더·좌측 레일 공유) */
export function useLiveTradingStatusPoll(): LiveTradingStatusResponse | null {
  const prefetched = peekLiveTradingPrefetch();
  const [status, setStatus] = useState<LiveTradingStatusResponse | null>(
    sharedStatus ?? prefetched?.status ?? null,
  );

  useEffect(() => {
    ensurePoll();
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
