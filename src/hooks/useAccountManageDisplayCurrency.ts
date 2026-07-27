import { useCallback, useState } from "react";

export type AccountManageDisplayCurrency = "KRW" | "USD";

const STORAGE_KEY = "stock-account-manage-display-currency-v1";

function readCurrency(): AccountManageDisplayCurrency {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "USD" || v === "KRW") return v;
  } catch {
    /* private mode / quota */
  }
  return "KRW";
}

function writeCurrency(v: AccountManageDisplayCurrency): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* private mode / quota */
  }
}

/** 계좌관리 금액 표시 통화 — 브라우저에만 저장 */
export function useAccountManageDisplayCurrency(): readonly [
  AccountManageDisplayCurrency,
  (next: AccountManageDisplayCurrency) => void,
] {
  const [currency, setCurrency] = useState(readCurrency);

  const setDisplayCurrency = useCallback((next: AccountManageDisplayCurrency) => {
    setCurrency(next);
    writeCurrency(next);
  }, []);

  return [currency, setDisplayCurrency] as const;
}
