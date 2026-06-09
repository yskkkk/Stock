import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchTossAccountSnapshot,
  type AuthUser,
  type TossTestSnapshot,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";

const DEFAULT_POLL_MS = 45_000;
/** 토스 Open API(잔고·수량) — ACCOUNT 1TPS 보호 */
export const TOSS_LEDGER_POLL_MS = 15_000;

export function useTossAccountSnapshot(opts?: {
  poll?: boolean;
  pollIntervalMs?: number;
}) {
  const poll = opts?.poll ?? false;
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<TossTestSnapshot | null>(null);
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const applySnapshotResponse = useCallback(
    (out: Awaited<ReturnType<typeof fetchTossAccountSnapshot>>) => {
      if (out.ready && out.snapshot) {
        setSnapshot(out.snapshot);
        setFeeLabelKo(out.feeLabelKo ?? null);
        setUpdatedAtMs(
          typeof out.syncedAtMs === "number" && out.syncedAtMs > 0
            ? out.syncedAtMs
            : Date.now(),
        );
        setErr(out.stale ? (out.messageKo ?? null) : null);
      } else {
        setSnapshot(null);
        setFeeLabelKo(null);
        setUpdatedAtMs(null);
        setErr(out.messageKo ?? out.error ?? null);
      }
    },
    [],
  );

  const reload = useCallback(
    async (refresh = false, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const me = await fetchAuthMe();
        setUser(me.user);
        if (!me.user) {
          setSnapshot(null);
          setFeeLabelKo(null);
          setUpdatedAtMs(null);
          setErr(null);
          return;
        }
        const out = await fetchTossAccountSnapshot({ refresh });
        applySnapshotResponse(out);
      } catch (e) {
        setSnapshot(null);
        setUpdatedAtMs(null);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setAuthChecked(true);
        if (!silent) setLoading(false);
      }
    },
    [applySnapshotResponse],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      await reload(false);
      if (cancelled) return;
      if (poll) await reload(true, true);
    })();

    const id = poll
      ? window.setInterval(() => {
          void reload(true, true);
        }, pollIntervalMs)
      : undefined;

    const onAuthChange = () => {
      void reload(true, false);
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      cancelled = true;
      if (id != null) window.clearInterval(id);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    };
  }, [poll, pollIntervalMs, reload]);

  return {
    user,
    authChecked,
    snapshot,
    feeLabelKo,
    updatedAtMs,
    loading,
    err,
    reload,
  };
}
