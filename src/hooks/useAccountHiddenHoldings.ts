import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeAccountStyleTicker } from "../../shared/account-holding-style-policy.js";

const STORAGE_PREFIX = "stock-account-manage-hidden-holdings-v1:";

function storageKey(userId: string | null | undefined): string | null {
  const uid = userId?.trim();
  return uid ? `${STORAGE_PREFIX}${uid}` : null;
}

function readHidden(userId: string | null | undefined): string[] {
  const key = storageKey(userId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      const t = normalizeAccountStyleTicker(String(item ?? ""));
      if (t) out.push(t);
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
}

function writeHidden(userId: string | null | undefined, tickers: string[]): void {
  const key = storageKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(tickers));
  } catch {
    /* private mode / quota */
  }
}

/** 계좌관리 보유 숨김 — 로그인 계정별 브라우저 저장 (차트·평가금 제외) */
export function useAccountHiddenHoldings(userId?: string | null): {
  hiddenTickers: ReadonlySet<string>;
  isHidden: (symbol: string) => boolean;
  toggleHidden: (symbol: string) => void;
  clearHidden: () => void;
} {
  const [list, setList] = useState(() => readHidden(userId));

  useEffect(() => {
    setList(readHidden(userId));
  }, [userId]);

  const hiddenTickers = useMemo(() => new Set(list), [list]);

  const isHidden = useCallback(
    (symbol: string) => hiddenTickers.has(normalizeAccountStyleTicker(symbol)),
    [hiddenTickers],
  );

  const toggleHidden = useCallback(
    (symbol: string) => {
      const t = normalizeAccountStyleTicker(symbol);
      if (!t) return;
      setList((prev) => {
        const next = prev.includes(t)
          ? prev.filter((x) => x !== t)
          : [...prev, t];
        writeHidden(userId, next);
        return next;
      });
    },
    [userId],
  );

  const clearHidden = useCallback(() => {
    setList([]);
    writeHidden(userId, []);
  }, [userId]);

  return { hiddenTickers, isHidden, toggleHidden, clearHidden };
}
