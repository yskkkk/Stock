/** 앱 내장 차트( lightweight-charts ) 드로잉 모드 */
export type ChartDrawMode = "cursor" | "hline" | "ray";

export interface ChartDrawToolbarApi {
  clearAll: () => void;
}
