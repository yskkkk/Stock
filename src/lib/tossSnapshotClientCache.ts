import type { TossFeeRatesByMarket, TossTestSnapshot } from "../api";

export type TossSnapshotCacheRow = {
  snapshot: TossTestSnapshot;
  feeLabelKo?: string | null;
  tossRoundTripFeeRate?: number | null;
  tossFeeRatesByMarket?: TossFeeRatesByMarket | null;
  syncedAtMs?: number | null;
};

const LS_PREFIX = "ystock:toss-snapshot:";
const LAST_USER_KEY = "ystock:toss-snapshot:last-user";

/** 탭 전환·리마운트 간 즉시 표시 — 프로세스 메모리 */
const memory = new Map<string, TossSnapshotCacheRow>();

export function readLastTossSnapshotUserId(): string | null {
  try {
    const id = sessionStorage.getItem(LAST_USER_KEY)?.trim();
    return id || null;
  } catch {
    return null;
  }
}

export function rememberTossSnapshotUserId(userId: string): void {
  const uid = userId.trim();
  if (!uid) return;
  try {
    sessionStorage.setItem(LAST_USER_KEY, uid);
  } catch {
    /* ignore */
  }
}

export function clearTossSnapshotUserId(): void {
  try {
    sessionStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* ignore */
  }
}

export function readTossSnapshotCache(userId: string): TossSnapshotCacheRow | null {
  const uid = userId.trim();
  if (!uid) return null;
  const hit = memory.get(uid);
  if (hit?.snapshot) return hit;
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TossSnapshotCacheRow;
    if (!parsed?.snapshot) return null;
    memory.set(uid, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeTossSnapshotCache(userId: string, row: TossSnapshotCacheRow): void {
  const uid = userId.trim();
  if (!uid || !row.snapshot) return;
  memory.set(uid, row);
  try {
    localStorage.setItem(`${LS_PREFIX}${uid}`, JSON.stringify(row));
  } catch {
    /* quota */
  }
}

export function clearTossSnapshotCache(userId?: string): void {
  if (userId) {
    const uid = userId.trim();
    memory.delete(uid);
    try {
      localStorage.removeItem(`${LS_PREFIX}${uid}`);
    } catch {
      /* ignore */
    }
    return;
  }
  memory.clear();
}

/** 로그인 전·직후 — 마지막 사용자 캐시로 초기값 */
export function peekTossSnapshotCacheForLastUser(): TossSnapshotCacheRow | null {
  const uid = readLastTossSnapshotUserId();
  if (!uid) return null;
  return readTossSnapshotCache(uid);
}
