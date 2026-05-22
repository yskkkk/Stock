import type { RecommendationsTrackerResponse } from "../types";

/** 첫 화면용 시세 배치(전체 96보다 작게 — 체감 로딩 단축) */
export const TRACKER_QUOTE_BATCH_INITIAL = 32;
/** 주기 갱신·2차 배치 상한 */
export const TRACKER_QUOTE_BATCH_MAX = 96;
/** 서버 스냅샷과 동일 기준 */
export const TRACKER_SNAPSHOT_STALE_MS = 45_000;

export function isRecTrackerSnapshotStale(
  snap: RecommendationsTrackerResponse,
): boolean {
  const at = snap.snapshotAtMs ?? snap.updatedAtMs ?? 0;
  if (!at || !Number.isFinite(at)) return true;
  if (snap.fromSnapshot !== true) return true;
  return Date.now() - at >= TRACKER_SNAPSHOT_STALE_MS;
}
