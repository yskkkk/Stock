import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchBithumbAccountSnapshot,
  type AuthUser,
  type BithumbTestSnapshot,
} from "../api";
import { LIVE_TRADE_AUTH_CHANGE } from "../lib/liveTradeAuthEvents";

const POLL_MS = 45_000;

export function useBithumbAccountSnapshot() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
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
      const out = await fetchBithumbAccountSnapshot();
      if (out.ready && out.snapshot) {
        setSnapshot(out.snapshot);
        setFeeLabelKo(out.feeLabelKo ?? null);
        setUpdatedAtMs(Date.now());
        setErr(null);
      } else {
        setSnapshot(null);
        setFeeLabelKo(null);
        setUpdatedAtMs(null);
        setErr(out.messageKo ?? null);
      }
    } catch (e) {
      setSnapshot(null);
      setUpdatedAtMs(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), POLL_MS);
    const onAuthChange = () => {
      void reload();
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    };
  }, [reload]);

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
