import { useEffect, useRef } from "react";
import type { StockPick } from "../types";

const STORAGE_KEY = "bullish-notify-seen";

/** 브라우저 상승 유망 알림(이 탭) 이력 초기화 */
export function clearBullishNotifySeen() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function useBullishNotify(
  picks: StockPick[],
  enabled: boolean,
) {
  const seenRef = useRef<Set<string>>(loadSeen());
  const askedRef = useRef(false);

  useEffect(() => {
    if (!enabled || picks.length === 0) return;

    if (!askedRef.current && typeof Notification !== "undefined") {
      askedRef.current = true;
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }

    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const seen = seenRef.current;
    const newcomers = picks.filter((p) => !seen.has(p.symbol));
    if (newcomers.length === 0) return;

    const top = newcomers.slice(0, 3);
    const body =
      top.map((p) => `${p.name} (${p.score}점)`).join(", ") +
      (newcomers.length > 3 ? ` 외 ${newcomers.length - 3}건` : "");

    try {
      new Notification("상승 유망 종목", { body });
    } catch {
      /* ignore */
    }

    for (const p of picks) seen.add(p.symbol);
    saveSeen(seen);
  }, [picks, enabled]);
}
