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

/** 파일 캐시·클라이언트 캐시 — 기본 (좌측 레일·독 등) */
export const TOSS_LEDGER_POLL_MS = 8_000;
/** 토스 Open API(잔고·수량) — ACCOUNT 1TPS 보호 */
export const TOSS_LEDGER_API_REFRESH_MS = 15_000;
/**
 * 계좌 탭 잔고 폴링 — 시세는 useTossSnapshotLiveQuotes가 담당.
 * 너무 짧으면 스냅샷 요청 폭주로 시세 API까지 막힘.
 */
export const ACCOUNT_TAB_TOSS_CACHE_POLL_MS = 3_000;
export const ACCOUNT_TAB_TOSS_API_REFRESH_MS = 12_000;

/** 동시에 여러 컴포넌트가 호출해도 1건만 네트워크 */
type SnapshotRes = Awaited<ReturnType<typeof fetchTossAccountSnapshot>>;
let inflightRefresh: Promise<SnapshotRes> | null = null;
let inflightCache: Promise<SnapshotRes> | null = null;

function fetchTossAccountSnapshotCoalesced(refresh: boolean): Promise<SnapshotRes> {
  if (refresh) {
    if (inflightRefresh) return inflightRefresh;
    inflightRefresh = fetchTossAccountSnapshot({ refresh: true }).finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  }
  if (inflightRefresh) return inflightRefresh;
  if (inflightCache) return inflightCache;
  inflightCache = fetchTossAccountSnapshot({ refresh: false }).finally(() => {
    inflightCache = null;
  });
  return inflightCache;
}

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
  const reloadRef = useRef<
    (refresh?: boolean, silent?: boolean) => Promise<void>
  >(async () => {});

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
      // 자동 폴링은 UI「갱신 중」을 절대 켜지 않음
      const trackSync = !silent;
      if (trackSync) {
        syncingRef.current += 1;
        setSyncing(true);
      }
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
        const out = await fetchTossAccountSnapshotCoalesced(refresh);
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

  reloadRef.current = reload;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      // 최초 1회만 로딩 표시 — 이후 폴링은 silent
      await reloadRef.current(false, Boolean(boot.hasCache));
    })();

    if (!poll) {
      return () => {
        cancelled = true;
      };
    }

    const cacheId = window.setInterval(() => {
      void reloadRef.current(false, true);
    }, Math.max(2_000, pollIntervalMs));

    const apiId = window.setInterval(() => {
      void reloadRef.current(true, true);
    }, Math.max(8_000, apiRefreshIntervalMs));

    const onAuthChange = () => {
      void reloadRef.current(true, false);
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      cancelled = true;
      window.clearInterval(cacheId);
      window.clearInterval(apiId);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    };
    // reload를 deps에 넣지 않음 — identity 변경으로 폴링이 재기동·폭주하는 것 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot.hasCache stable for mount
  }, [poll, pollIntervalMs, apiRefreshIntervalMs]);

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
