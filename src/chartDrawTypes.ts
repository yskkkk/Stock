/** 앱 내장 차트( lightweight-charts ) 드로잉 모드 */
export type ChartDrawMode = "cursor" | "hline" | "ray";

/** `false`면 광선 툴바·차트 상 광선 그리기 비활성(일시). 다시 켤 때 `true`로 변경. */
export const CHART_DRAW_RAY_TOOL_ENABLED = true;

export interface ChartDrawToolbarApi {
  clearAll: () => void;
}
