import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAuthMe,
  fetchTossAccountSnapshot,
  type AuthUser,
  type TossTestSnapshot,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";
import {
  clearTossSnapshotCache,
  clearTossSnapshotUserId,
  peekTossSnapshotCacheForLastUser,
  readTossSnapshotCache,
  rememberTossSnapshotUserId,
  writeTossSnapshotCache,
} from "../lib/tossSnapshotClientCache";

/** 파일 캐시·클라이언트 캐시 — 1초 (거래소 API 미호출) */
export const TOSS_LEDGER_POLL_MS = 1_000;
/** 토스 Open API(잔고·수량) — ACCOUNT 1TPS 보호 */
export const TOSS_LEDGER_API_REFRESH_MS = 15_000;

function hydrateFromClientCache(userId: string): {
  snapshot: TossTestSnapshot;
  feeLabelKo: string | null;
  updatedAtMs: number | null;
} | null {
  const row = readTossSnapshotCache(userId);
  if (!row?.snapshot) return null;
  return {
    snapshot: row.snapshot,
    feeLabelKo: row.feeLabelKo ?? null,
    updatedAtMs:
      typeof row.syncedAtMs === "number" && row.syncedAtMs > 0
        ? row.syncedAtMs
        : null,
  };
}

export function useTossAccountSnapshot(opts?: {
  poll?: boolean;
  pollIntervalMs?: number;
  apiRefreshIntervalMs?: number;
}) {
  const poll = opts?.poll ?? false;
  const pollIntervalMs = opts?.pollIntervalMs ?? TOSS_LEDGER_POLL_MS;
  const apiRefreshIntervalMs =
    opts?.apiRefreshIntervalMs ?? TOSS_LEDGER_API_REFRESH_MS;
  const peek = peekTossSnapshotCacheForLastUser();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<TossTestSnapshot | null>(
    () => peek?.snapshot ?? null,
  );
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(
    () => peek?.feeLabelKo ?? null,
  );
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(() => {
    if (peek?.syncedAtMs != null && peek.syncedAtMs > 0) return peek.syncedAtMs;
    return null;
  });
  const [loading, setLoading] = useState(() => !peek?.snapshot);
  const [err, setErr] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const snapshotRef = useRef<TossTestSnapshot | null>(peek?.snapshot ?? null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const persistSnapshot = useCallback(
    (
      uid: string,
      snap: TossTestSnapshot,
      fee: string | null,
      syncedAt: number | null,
    ) => {
      rememberTossSnapshotUserId(uid);
      writeTossSnapshotCache(uid, {
        snapshot: snap,
        feeLabelKo: fee,
        syncedAtMs: syncedAt,
      });
    },
    [],
  );

  const applySnapshotResponse = useCallback(
    (
      out: Awaited<ReturnType<typeof fetchTossAccountSnapshot>>,
      uid: string | null,
      keepStale: boolean,
    ) => {
      if (out.ready && out.snapshot) {
        const syncedAt =
          typeof out.syncedAtMs === "number" && out.syncedAtMs > 0
            ? out.syncedAtMs
            : Date.now();
        setSnapshot(out.snapshot);
        setFeeLabelKo(out.feeLabelKo ?? null);
        setUpdatedAtMs(syncedAt);
        setErr(out.stale ? (out.messageKo ?? null) : null);
        if (uid) {
          persistSnapshot(uid, out.snapshot, out.feeLabelKo ?? null, syncedAt);
        }
        return;
      }
      setErr(out.messageKo ?? out.error ?? null);
      if (!keepStale) {
        setSnapshot(null);
        setFeeLabelKo(null);
        setUpdatedAtMs(null);
        if (uid) clearTossSnapshotCache(uid);
      }
    },
    [persistSnapshot],
  );

  const reload = useCallback(
    async (refresh = false, silent = false) => {
      const uid = userRef.current?.id ?? null;
      const hasLocal = Boolean(uid && readTossSnapshotCache(uid));
      if (!silent && !hasLocal && !snapshotRef.current) setLoading(true);
      try {
        const me = await fetchAuthMe();
        setUser(me.user);
        userRef.current = me.user;
        if (!me.user) {
          setSnapshot(null);
          setFeeLabelKo(null);
          setUpdatedAtMs(null);
          setErr(null);
          clearTossSnapshotUserId();
          return;
        }
        rememberTossSnapshotUserId(me.user.id);
        const cached = hydrateFromClientCache(me.user.id);
        if (cached && !refresh) {
          setSnapshot(cached.snapshot);
          setFeeLabelKo(cached.feeLabelKo);
          setUpdatedAtMs(cached.updatedAtMs);
        }
        const out = await fetchTossAccountSnapshot({ refresh });
        applySnapshotResponse(
          out,
          me.user.id,
          Boolean(cached?.snapshot || snapshotRef.current),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        if (!uid || !readTossSnapshotCache(uid)) {
          setSnapshot(null);
          setUpdatedAtMs(null);
        }
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
      await reload(false, Boolean(peek?.snapshot));
      if (cancelled || !poll) return;
      await reload(true, true);
    })();

    const cacheId = poll
      ? window.setInterval(() => {
          void reload(false, true);
        }, pollIntervalMs)
      : undefined;

    const apiId = poll
      ? window.setInterval(() => {
          void reload(true, true);
        }, apiRefreshIntervalMs)
      : undefined;

    const onAuthChange = () => {
      void reload(true, false);
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      cancelled = true;
      if (cacheId != null) window.clearInterval(cacheId);
      if (apiId != null) window.clearInterval(apiId);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    };
  }, [poll, pollIntervalMs, apiRefreshIntervalMs, reload]);

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
