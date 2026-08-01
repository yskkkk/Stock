import { useCallback, useEffect, useState } from "react";

export type AccountManageDisplayCurrency = "KRW" | "USD";

const STORAGE_PREFIX = "stock-account-manage-display-currency-v1:";
const LEGACY_KEY = "stock-account-manage-display-currency-v1";

function storageKey(userId: string | null | undefined): string | null {
  const uid = userId?.trim();
  return uid ? `${STORAGE_PREFIX}${uid}` : null;
}

function readCurrency(userId: string | null | undefined): AccountManageDisplayCurrency {
  const key = storageKey(userId);
  try {
    if (key) {
      const v = localStorage.getItem(key);
      if (v === "USD" || v === "KRW") return v;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "USD" || legacy === "KRW") return legacy;
  } catch {
    /* private mode / quota */
  }
  return "KRW";
}

function writeCurrency(
  userId: string | null | undefined,
  v: AccountManageDisplayCurrency,
): void {
  const key = storageKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode / quota */
  }
}

/** 계좌관리 금액 표시 통화 — 로그인 계정별로 브라우저에 저장 */
export function useAccountManageDisplayCurrency(
  userId?: string | null,
): readonly [AccountManageDisplayCurrency, (next: AccountManageDisplayCurrency) => void] {
  const [currency, setCurrency] = useState(() => readCurrency(userId));

  useEffect(() => {
    setCurrency(readCurrency(userId));
  }, [userId]);

  const setDisplayCurrency = useCallback(
    (next: AccountManageDisplayCurrency) => {
      setCurrency(next);
      writeCurrency(userId, next);
    },
    [userId],
  );

  return [currency, setDisplayCurrency] as const;
}
