import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAuthMe,
  fetchBithumbAccountSnapshot,
  type AuthUser,
  type BithumbTestSnapshot,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";

const VISIBLE_POLL_MS = 5_000;
/** 계좌 탭 등 빠른 갱신이 필요할 때 */
export const ACCOUNT_TAB_BITHUMB_POLL_MS = 2_000;

export function useBithumbAccountSnapshot(opts?: {
  poll?: boolean;
  pollIntervalMs?: number;
}) {
  const poll = opts?.poll ?? false;
  const pollIntervalMs = opts?.pollIntervalMs ?? VISIBLE_POLL_MS;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const syncingRef = useRef(0);

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

  const snapshotRef = useRef<BithumbTestSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const reload = useCallback(
    async (refresh = false, silent = false) => {
      const trackSync = !silent;
      if (trackSync) {
        syncingRef.current += 1;
        setSyncing(true);
      }
      if (!silent && !snapshotRef.current) setLoading(true);
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
        if (trackSync) {
          syncingRef.current = Math.max(0, syncingRef.current - 1);
          setSyncing(syncingRef.current > 0);
        }
        setAuthChecked(true);
        if (!silent) setLoading(false);
      }
    },
    [applySnapshotResponse],
  );

  useEffect(() => {
    let cancelled = false;

    // 토스 선택 시에는 빗썸 스냅샷을 아예 요청하지 않음 (계좌 탭 진입 지연 방지)
    if (!poll) {
      setLoading(false);
      setAuthChecked(true);
      return;
    }

    void (async () => {
      if (cancelled) return;
      await reload(false, false);
    })();

    // 캐시성 폴링은 silent — 스피너 고착 방지. 잔고 refresh는 주기적으로만.
    const cacheId = window.setInterval(() => {
      void reload(false, true);
    }, pollIntervalMs);
    const refreshId = window.setInterval(() => {
      void reload(true, true);
    }, Math.max(pollIntervalMs * 4, 8_000));

    const onAuthChange = () => {
      void reload(true, false);
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      cancelled = true;
      window.clearInterval(cacheId);
      window.clearInterval(refreshId);
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
    syncing,
    err,
    reload,
  };
}
