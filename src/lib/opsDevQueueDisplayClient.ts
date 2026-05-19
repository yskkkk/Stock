import {
  fetchOpsDevQueueDisplay,
  type OpsDevQueueDisplayResponse,
} from "../api";
import { OPS_DEV_QUEUE_POLL_MS } from "../constants/opsDevQueuePoll";
import { agentEntriesSnapshotKey } from "./opsGlobalQueueRows";

export type OpsDevQueueDisplayListener = (snap: OpsDevQueueDisplayResponse) => void;

let subscribers = new Set<OpsDevQueueDisplayListener>();
let viewerIpSubscriberCount = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<OpsDevQueueDisplayResponse> | null = null;
let lastAgentKey = "";
let lastViewerIp: string | null | undefined;
let lastSnap: OpsDevQueueDisplayResponse | null = null;
let visibilityHandler: (() => void) | null = null;

function notify(snap: OpsDevQueueDisplayResponse) {
  for (const fn of subscribers) {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  }
}

function snapChanged(
  snap: OpsDevQueueDisplayResponse,
  includeViewerIp: boolean,
): boolean {
  const agentKey = agentEntriesSnapshotKey(snap.agentEntries);
  if (agentKey !== lastAgentKey) return true;
  if (!includeViewerIp) return false;
  const ip =
    snap.viewerIp === null || snap.viewerIp === undefined
      ? null
      : String(snap.viewerIp).trim() || null;
  return ip !== lastViewerIp;
}

async function pullOnce(includeViewerIp: boolean): Promise<OpsDevQueueDisplayResponse> {
  if (inFlight) return inFlight;
  inFlight = fetchOpsDevQueueDisplay({ includeViewerIp })
    .then((snap) => {
      if (snapChanged(snap, includeViewerIp)) {
        lastAgentKey = agentEntriesSnapshotKey(snap.agentEntries);
        if (includeViewerIp) {
          lastViewerIp =
            snap.viewerIp === null || snap.viewerIp === undefined
              ? null
              : String(snap.viewerIp).trim() || null;
        }
        lastSnap = snap;
        notify(snap);
      }
      return snap;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function ensurePolling() {
  if (intervalId != null || subscribers.size === 0) return;
  const tick = () => {
    void pullOnce(viewerIpSubscriberCount > 0);
  };
  tick();
  intervalId = setInterval(tick, OPS_DEV_QUEUE_POLL_MS);
  visibilityHandler = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function stopPolling() {
  if (intervalId == null) return;
  clearInterval(intervalId);
  intervalId = null;
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

/**
 * 개발 대기열 표시 — 앱 전역 단일 폴러(주기는 OPS_DEV_QUEUE_POLL_MS).
 * 스트립·운영 탭이 동시에 마운트돼도 HTTP 1회.
 */
export function subscribeOpsDevQueueDisplay(
  listener: OpsDevQueueDisplayListener,
  opts?: { includeViewerIp?: boolean },
): () => void {
  const needIp = Boolean(opts?.includeViewerIp);
  if (needIp) viewerIpSubscriberCount++;
  subscribers.add(listener);
  if (lastSnap) listener(lastSnap);
  ensurePolling();
  return () => {
    subscribers.delete(listener);
    if (needIp) viewerIpSubscriberCount = Math.max(0, viewerIpSubscriberCount - 1);
    if (subscribers.size === 0) stopPolling();
  };
}

export function getLastOpsDevQueueDisplaySnapshot(): OpsDevQueueDisplayResponse | null {
  return lastSnap;
}
