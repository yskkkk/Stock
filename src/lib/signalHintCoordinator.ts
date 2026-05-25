/** 조건 필터·추천 칩 툴팁 — 동시에 하나만 표시 */
let activeClose: (() => void) | null = null;

export function claimSignalHint(close: () => void): void {
  if (activeClose && activeClose !== close) {
    activeClose();
  }
  activeClose = close;
}

export function releaseSignalHint(close: () => void): void {
  if (activeClose === close) activeClose = null;
}

export function clearActiveSignalHint(): void {
  activeClose?.();
  activeClose = null;
}
