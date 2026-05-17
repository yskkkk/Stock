import type { IChartApi, IPriceLine, ISeriesApi, Time } from "lightweight-charts";
import {
  rayHandlePanePositions,
  type ChartDrawingModel,
  type RayDrawingModel,
} from "./chartDrawings";

export type DrawingHitTarget =
  | { kind: "hline"; id: string; priceLine: IPriceLine }
  | { kind: "ray-body"; id: string }
  | { kind: "ray-anchor"; id: string }
  | { kind: "ray-through"; id: string };

function distPointToSeg2d(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const wx = px - x0;
  const wy = py - y0;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x0, py - y0);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x1, py - y1);
  const t = c1 / c2;
  const bx = x0 + t * vx;
  const by = y0 + t * vy;
  return Math.hypot(px - bx, py - by);
}

/** 광선 끝점(원·핸들) — 작으면 클릭이 빗나감 */
const RAY_ENDPOINT_HIT_PX = 16;
const LINE_HIT_PX = 7;

export function hitTestDrawings(
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  clientX: number,
  clientY: number,
  objects: ChartDrawingModel[],
): DrawingHitTarget | null {
  const pane0 = chart.panes()[0]?.getHTMLElement();
  if (!pane0) return null;
  const pr = pane0.getBoundingClientRect();
  if (
    clientX < pr.left ||
    clientX > pr.right ||
    clientY < pr.top ||
    clientY > pr.bottom
  ) {
    return null;
  }
  const px = clientX - pr.left;
  const py = clientY - pr.top;

  const ts = chart.timeScale();

  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.kind === "ray") {
      const d = o.series.data() as { time: Time; value: number }[];
      if (d.length < 2) continue;
      const p0 = d[0]!;
      const p1 = d[1]!;
      const x0 = ts.timeToCoordinate(p0.time);
      const x1 = ts.timeToCoordinate(p1.time);
      const y0 = candle.priceToCoordinate(p0.value);
      const y1 = candle.priceToCoordinate(p1.value);
      if (x0 == null || x1 == null || y0 == null || y1 == null) continue;
      const xa = x0 as number;
      const xb = x1 as number;
      const ya = y0 as number;
      const yb = y1 as number;

      const ray = o as RayDrawingModel;
      const hp = rayHandlePanePositions(chart, candle, ray);
      if (hp) {
        const dAnchor = Math.hypot(px - hp.ax, py - hp.ay);
        const dThrough = Math.hypot(px - hp.tx, py - hp.ty);
        const hitA = dAnchor <= RAY_ENDPOINT_HIT_PX;
        const hitT = dThrough <= RAY_ENDPOINT_HIT_PX;
        if (hitA && hitT) {
          if (Math.abs(dAnchor - dThrough) < 4) {
            return { kind: "ray-through", id: o.id };
          }
          return dAnchor < dThrough
            ? { kind: "ray-anchor", id: o.id }
            : { kind: "ray-through", id: o.id };
        }
        if (hitA) return { kind: "ray-anchor", id: o.id };
        if (hitT) return { kind: "ray-through", id: o.id };
      }
      const dm = distPointToSeg2d(px, py, xa, ya, xb, yb);
      if (dm <= LINE_HIT_PX) return { kind: "ray-body", id: o.id };
    }
  }

  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.kind === "hline") {
      const y = candle.priceToCoordinate(o.priceLine.options().price as number);
      if (y == null) continue;
      const d = Math.abs(py - (y as number));
      if (d <= LINE_HIT_PX) {
        return { kind: "hline", id: o.id, priceLine: o.priceLine };
      }
    }
  }
  return null;
}
