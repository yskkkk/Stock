import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAuthMe,
  fetchTossAccountSnapshot,
  type AuthUser,
  type TossFeeRatesByMarket,
  type TossTestSnapshot,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";
import {
  clearTossSnapshotCache,
  readLastTossSnapshotUserId,
  readTossSnapshotCache,
  rememberTossSnapshotUserId,
  writeTossSnapshotCache,
} from "../lib/tossSnapshotClientCache";
import { tossSnapshotLedgerFingerprint } from "../lib/tossSnapshotLiveQuotes";

/** 파일 캐시·클라이언트 캐시 — 5초 (거래소 API 15초 주기이므로 실시간성 동일) */
export const TOSS_LEDGER_POLL_MS = 5_000;
/** 토스 Open API(잔고·수량) — ACCOUNT 1TPS 보호 */
export const TOSS_LEDGER_API_REFRESH_MS = 15_000;

function hydrateFromClientCache(userId: string): {
  snapshot: TossTestSnapshot;
  feeLabelKo: string | null;
  tossRoundTripFeeRate: number | null;
  tossFeeRatesByMarket: TossFeeRatesByMarket | null;
  updatedAtMs: number | null;
} | null {
  const row = readTossSnapshotCache(userId);
  if (!row?.snapshot) return null;
  return {
    snapshot: row.snapshot,
    feeLabelKo: row.feeLabelKo ?? null,
    tossRoundTripFeeRate:
      row.tossRoundTripFeeRate != null && Number.isFinite(row.tossRoundTripFeeRate)
        ? row.tossRoundTripFeeRate
        : null,
    tossFeeRatesByMarket: row.tossFeeRatesByMarket ?? null,
    updatedAtMs:
      typeof row.syncedAtMs === "number" && row.syncedAtMs > 0
        ? row.syncedAtMs
        : null,
  };
}

function initialHydrate(): {
  snapshot: TossTestSnapshot | null;
  feeLabelKo: string | null;
  tossRoundTripFeeRate: number | null;
  tossFeeRatesByMarket: TossFeeRatesByMarket | null;
  updatedAtMs: number | null;
  hasCache: boolean;
} {
  const uid = readLastTossSnapshotUserId();
  if (!uid) {
    return {
      snapshot: null,
      feeLabelKo: null,
      tossRoundTripFeeRate: null,
      tossFeeRatesByMarket: null,
      updatedAtMs: null,
      hasCache: false,
    };
  }
  const cached = hydrateFromClientCache(uid);
  if (!cached) {
    return {
      snapshot: null,
      feeLabelKo: null,
      tossRoundTripFeeRate: null,
      tossFeeRatesByMarket: null,
      updatedAtMs: null,
      hasCache: false,
    };
  }
  return { ...cached, hasCache: true };
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
  const bootRef = useRef<ReturnType<typeof initialHydrate> | null>(null);
  if (!bootRef.current) bootRef.current = initialHydrate();
  const boot = bootRef.current;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<TossTestSnapshot | null>(
    () => boot.snapshot,
  );
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(
    () => boot.feeLabelKo,
  );
  const [tossRoundTripFeeRate, setTossRoundTripFeeRate] = useState<number | null>(
    () => boot.tossRoundTripFeeRate,
  );
  const [tossFeeRatesByMarket, setTossFeeRatesByMarket] =
    useState<TossFeeRatesByMarket | null>(() => boot.tossFeeRatesByMarket);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(
    () => boot.updatedAtMs,
  );
  const [loading, setLoading] = useState(() => !boot.hasCache);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const snapshotRef = useRef<TossTestSnapshot | null>(boot.snapshot);
  const syncingRef = useRef(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const persistSnapshot = useCallback(
    (
      uid: string,
      snap: TossTestSnapshot,
      fee: string | null,
      roundTrip: number | null,
      feeRates: TossFeeRatesByMarket | null,
      syncedAt: number | null,
    ) => {
      rememberTossSnapshotUserId(uid);
      writeTossSnapshotCache(uid, {
        snapshot: snap,
        feeLabelKo: fee,
        tossRoundTripFeeRate: roundTrip,
        tossFeeRatesByMarket: feeRates,
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
        setSnapshot((prev) => {
          if (
            prev &&
            tossSnapshotLedgerFingerprint(prev) ===
              tossSnapshotLedgerFingerprint(out.snapshot!)
          ) {
            return prev;
          }
          return out.snapshot!;
        });
        setFeeLabelKo(out.feeLabelKo ?? null);
        setTossRoundTripFeeRate(
          out.tossRoundTripFeeRate != null &&
            Number.isFinite(out.tossRoundTripFeeRate)
            ? out.tossRoundTripFeeRate
            : null,
        );
        setTossFeeRatesByMarket(out.tossFeeRatesByMarket ?? null);
        setUpdatedAtMs(syncedAt);
        setErr(out.stale ? (out.messageKo ?? null) : null);
        if (uid) {
          persistSnapshot(
            uid,
            out.snapshot,
            out.feeLabelKo ?? null,
            out.tossRoundTripFeeRate != null &&
              Number.isFinite(out.tossRoundTripFeeRate)
              ? out.tossRoundTripFeeRate
              : null,
            out.tossFeeRatesByMarket ?? null,
            syncedAt,
          );
        }
      } else {
        setErr(out.messageKo ?? out.error ?? null);
        if (!keepStale) {
          setSnapshot(null);
          setFeeLabelKo(null);
          setTossRoundTripFeeRate(null);
          setTossFeeRatesByMarket(null);
          setUpdatedAtMs(null);
          if (uid) clearTossSnapshotCache(uid);
        }
      }
    },
    [persistSnapshot],
  );

  const reload = useCallback(
    async (refresh = false, silent = false) => {
      const uid = userRef.current?.id ?? null;
      const hasLocal = Boolean(uid && readTossSnapshotCache(uid));
      syncingRef.current += 1;
      setSyncing(true);
      if (!silent && !hasLocal && !snapshotRef.current) setLoading(true);
      try {
        let meUser = userRef.current;
        if (!silent || !meUser) {
          const me = await fetchAuthMe();
          const prevId = userRef.current?.id ?? null;
          setUser(me.user);
          userRef.current = me.user;
          meUser = me.user;
          if (!me.user) {
            setSnapshot(null);
            setFeeLabelKo(null);
            setTossRoundTripFeeRate(null);
            setTossFeeRatesByMarket(null);
            setUpdatedAtMs(null);
            setErr(null);
            snapshotRef.current = null;
            clearTossSnapshotCache();
            return;
          }
          if (prevId && prevId !== me.user.id) {
            setSnapshot(null);
            setFeeLabelKo(null);
            setTossRoundTripFeeRate(null);
            setTossFeeRatesByMarket(null);
            setUpdatedAtMs(null);
            setErr(null);
            snapshotRef.current = null;
          }
          rememberTossSnapshotUserId(me.user.id);
        }
        if (!meUser) return;
        const cached = hydrateFromClientCache(meUser.id);
        if (cached && !refresh) {
          setSnapshot((prev) => {
            if (
              prev &&
              tossSnapshotLedgerFingerprint(prev) ===
                tossSnapshotLedgerFingerprint(cached.snapshot)
            ) {
              return prev;
            }
            return cached.snapshot;
          });
          setFeeLabelKo(cached.feeLabelKo);
          setTossRoundTripFeeRate(cached.tossRoundTripFeeRate);
          setTossFeeRatesByMarket(cached.tossFeeRatesByMarket);
          setUpdatedAtMs(cached.updatedAtMs);
        }
        const out = await fetchTossAccountSnapshot({ refresh });
        applySnapshotResponse(
          out,
          meUser.id,
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
        syncingRef.current = Math.max(0, syncingRef.current - 1);
        setSyncing(syncingRef.current > 0);
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
      await reload(false, false);
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
    tossRoundTripFeeRate,
    tossFeeRatesByMarket,
    updatedAtMs,
    loading,
    syncing,
    err,
    reload,
  };
}
