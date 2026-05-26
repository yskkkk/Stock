import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchBithumbAccountSnapshot,
  type AuthUser,
  type BithumbTestSnapshot,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";

const VISIBLE_POLL_MS = 1000;

export function useBithumbAccountSnapshot(opts?: { poll?: boolean }) {
  const poll = opts?.poll ?? false;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const applySnapshotResponse = useCallback(
    (out: Awaited<ReturnType<typeof fetchBithumbAccountSnapshot>>) => {
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
        const out = await fetchBithumbAccountSnapshot({ refresh });
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
        }, VISIBLE_POLL_MS)
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
  }, [poll, reload]);

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
