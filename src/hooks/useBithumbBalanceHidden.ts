import { useCallback, useState } from "react";

const STORAGE_KEY = "stock-bithumb-balance-hidden-v1";

function readHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
}

/** 빗썸 계좌 잔액 표시 — 브라우저에만 저장 */
export function useBithumbBalanceHidden(): readonly [boolean, () => void] {
  const [hidden, setHidden] = useState(readHidden);

  const toggle = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      writeHidden(next);
      return next;
    });
  }, []);

  return [hidden, toggle] as const;
}
