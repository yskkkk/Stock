import { useEffect, useState } from "react";
import type { OpsDevQueueDisplayResponse } from "../api";
import {
  getLastOpsDevQueueDisplaySnapshot,
  subscribeOpsDevQueueDisplay,
} from "../lib/opsDevQueueDisplayClient";

export function useOpsDevQueueDisplay(opts?: {
  includeViewerIp?: boolean;
  enabled?: boolean;
}): OpsDevQueueDisplayResponse | null {
  const enabled = opts?.enabled !== false;
  const includeViewerIp = Boolean(opts?.includeViewerIp);
  const [snap, setSnap] = useState<OpsDevQueueDisplayResponse | null>(() =>
    getLastOpsDevQueueDisplaySnapshot(),
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribeOpsDevQueueDisplay(setSnap, { includeViewerIp });
  }, [enabled, includeViewerIp]);

  return snap;
}
