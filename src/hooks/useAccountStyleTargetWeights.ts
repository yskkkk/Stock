import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_STYLE_TARGET_PARTS,
  normalizeStyleTargetParts,
  type StyleTargetParts,
} from "../lib/accountAllocation";

const STORAGE_PREFIX = "stock-account-style-target-weights-v1:";

type AccountProvider = "toss" | "bithumb";

function storageKey(
  userId: string | null | undefined,
  provider: AccountProvider,
): string | null {
  const uid = userId?.trim();
  if (!uid) return null;
  return `${STORAGE_PREFIX}${uid}:${provider}`;
}

function readParts(
  userId: string | null | undefined,
  provider: AccountProvider,
): StyleTargetParts {
  const key = storageKey(userId, provider);
  try {
    if (key) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { growth?: unknown; value?: unknown };
        const normalized = normalizeStyleTargetParts(
          Number(parsed.growth),
          Number(parsed.value),
        );
        if (normalized) return normalized;
      }
    }
  } catch {
    /* private mode / quota / bad json */
  }
  return { ...DEFAULT_STYLE_TARGET_PARTS };
}

function writeParts(
  userId: string | null | undefined,
  provider: AccountProvider,
  parts: StyleTargetParts,
): void {
  const key = storageKey(userId, provider);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(parts));
  } catch {
    /* private mode / quota */
  }
}

/** 성장:가치 목표 비중(합 10) — 로그인 유저 × 계좌(토스/빗썸)별 브라우저 저장 */
export function useAccountStyleTargetWeights(
  userId: string | null | undefined,
  provider: AccountProvider,
): readonly [
  StyleTargetParts,
  (next: StyleTargetParts) => void,
  (growthParts: number) => void,
] {
  const [parts, setParts] = useState(() => readParts(userId, provider));

  useEffect(() => {
    setParts(readParts(userId, provider));
  }, [userId, provider]);

  const setTargetParts = useCallback(
    (next: StyleTargetParts) => {
      const normalized = normalizeStyleTargetParts(next.growth, next.value);
      if (!normalized) return;
      setParts(normalized);
      writeParts(userId, provider, normalized);
    },
    [userId, provider],
  );

  /** 성장 파트를 바꾸면 가치 = 10 − 성장 */
  const setGrowthParts = useCallback(
    (growthParts: number) => {
      const normalized = normalizeStyleTargetParts(growthParts);
      if (!normalized) return;
      setParts(normalized);
      writeParts(userId, provider, normalized);
    },
    [userId, provider],
  );

  return [parts, setTargetParts, setGrowthParts] as const;
}
