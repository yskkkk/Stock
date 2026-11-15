import { useCallback, useEffect, useState } from "react";
import {
  fetchTossRebalanceAlertSettings,
  putTossRebalanceAlertSettings,
  type TossRebalanceAlertSettings,
} from "../api";

const DEFAULT: TossRebalanceAlertSettings = {
  enabled: false,
  thresholdPctPoints: 5,
  updatedAtMs: null,
};

/**
 * 토스 계좌 전용 — 성장/가치 괴리 알림 설정 (서버 계좌별 파일).
 * 빗썸 등 다른 provider에서는 호출하지 말 것.
 */
export function useTossRebalanceAlertSettings(
  userId: string | null | undefined,
  active: boolean,
): {
  settings: TossRebalanceAlertSettings;
  loading: boolean;
  setEnabled: (enabled: boolean) => void;
  setThresholdPctPoints: (n: number) => void;
} {
  const [settings, setSettings] = useState<TossRebalanceAlertSettings>(DEFAULT);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || !active) {
      setSettings(DEFAULT);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchTossRebalanceAlertSettings()
      .then((res) => {
        if (cancelled) return;
        if (res?.settings) setSettings(res.settings);
      })
      .catch(() => {
        if (!cancelled) setSettings(DEFAULT);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, active]);

  const persist = useCallback(
    (patch: { enabled?: boolean; thresholdPctPoints?: number }) => {
      if (!userId || !active) return;
      setSettings((prev) => ({
        ...prev,
        ...patch,
        updatedAtMs: Date.now(),
      }));
      void putTossRebalanceAlertSettings(patch)
        .then((res) => {
          if (res?.settings) setSettings(res.settings);
        })
        .catch(() => {
          /* keep optimistic; next load corrects */
        });
    },
    [userId, active],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => persist({ enabled }),
    [persist],
  );

  const setThresholdPctPoints = useCallback(
    (n: number) => persist({ thresholdPctPoints: n }),
    [persist],
  );

  return { settings, loading, setEnabled, setThresholdPctPoints };
}
