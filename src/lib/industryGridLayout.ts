/** 국내 수급·종목보관 업종 필터 — 가로 3열(세로 채움) */
export const INDUSTRY_GRID_TARGET_COLS = 3;

export function industryGridDimensions(tabCount: number): {
  rows: number;
  cols: number;
} {
  const n = Math.max(0, tabCount);
  const cols = INDUSTRY_GRID_TARGET_COLS;
  if (n === 0) return { rows: 1, cols };
  return { rows: Math.ceil(n / cols), cols };
}
