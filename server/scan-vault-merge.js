/**
 * 스캔 결과가 vault를 갱신해도 되는지 판별.
 * - failed_empty_universe: 유니버스 0건 → 기존 vault 유지
 * - failed_high_errors: 오류 비율 과다 → 기존 vault 유지
 * - ok_with_hits: 정상 스캔 + 적중 → clear + merge
 * - ok_zero_hits: 정상 스캔 + 0적중 → clear만(이전 적중 제거)
 */

/** @typedef {"failed_empty_universe"|"failed_high_errors"|"ok_with_hits"|"ok_zero_hits"} ScanVaultMergeOutcome */

/**
 * @param {{
 *   scanned?: number;
 *   hitCount?: number;
 *   hits?: unknown[];
 *   errors?: number;
 *   minScanned?: number;
 *   maxErrorRatio?: number;
 *   maxErrorsFloor?: number;
 * }} p
 */
export function assessScanVaultMerge(p) {
  const scanned = Math.max(0, Number(p.scanned) || 0);
  const hitCount = Math.max(
    0,
    Number(p.hitCount) ||
      (Array.isArray(p.hits) ? p.hits.length : 0),
  );
  const errors = Math.max(0, Number(p.errors) || 0);
  const minScanned = p.minScanned ?? 1;
  const maxErrorRatio = p.maxErrorRatio ?? 0.12;
  const maxErrorsFloor = p.maxErrorsFloor ?? 30;

  /** @type {ScanVaultMergeOutcome} */
  let outcome;
  let shouldClear = false;
  let shouldMerge = false;
  let errorRatio = null;

  if (scanned < minScanned) {
    outcome = "failed_empty_universe";
  } else {
    errorRatio = scanned > 0 ? errors / scanned : 0;
    if (errors > maxErrorsFloor && errorRatio > maxErrorRatio) {
      outcome = "failed_high_errors";
    } else if (hitCount > 0) {
      outcome = "ok_with_hits";
      shouldClear = true;
      shouldMerge = true;
    } else {
      outcome = "ok_zero_hits";
      shouldClear = true;
    }
  }

  return {
    outcome,
    shouldClear,
    shouldMerge,
    scanned,
    hitCount,
    errors,
    errorRatio,
  };
}

/**
 * @param {ReturnType<typeof assessScanVaultMerge>} assessment
 * @param {{ clear: () => void; merge: (hits: unknown[]) => void }} vault
 * @param {unknown[]} [hits]
 */
export function applyVaultScanMerge(assessment, vault, hits = []) {
  if (assessment.shouldClear) vault.clear();
  if (assessment.shouldMerge && hits.length) vault.merge(hits);
  return assessment;
}
