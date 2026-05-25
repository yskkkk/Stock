import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export type BoxRangeChartBox = {
  boxId: string;
  top: number;
  bottom: number;
  mid: number;
  timeframe: string;
  state: string;
  leftTime: number;
  rightTime: number;
};

type BoxRangePaneData = {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  boxes: BoxRangeChartBox[];
  chartInterval: string;
};

const STRATEGY_TF_SEC: Record<string, number> = {
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

function chartBarSeconds(interval: string): number {
  const m: Record<string, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
  };
  return m[interval] ?? 3600;
}

/** 차트 봉보다 굵은 TF 박스는 그리지 않음(1d 박스가 1h 차트 좌측 전체를 덮는 문제 방지) */
export function shouldDrawBoxOnChart(
  boxTimeframe: string,
  chartInterval: string,
): boolean {
  const boxSec = STRATEGY_TF_SEC[boxTimeframe];
  if (!boxSec) return false;
  const chartSec = chartBarSeconds(chartInterval);
  if (chartSec <= 900) return true;
  return boxSec <= chartSec;
}

function timeSortKey(t: Time): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }
  return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000);
}

function resolveTimeX(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  unixSec: number,
): number | null {
  const direct = chart.timeScale().timeToCoordinate(unixSec as Time);
  if (direct != null && Number.isFinite(direct)) return direct;

  const bars = series.data() as { time: Time }[];
  if (!bars.length) return null;

  let best = bars[0]!;
  let bestD = Math.abs(timeSortKey(best.time) - unixSec);
  for (const b of bars) {
    const d = Math.abs(timeSortKey(b.time) - unixSec);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }

  const maxSlop = chartBarSeconds("1h") * 2;
  if (bestD > maxSlop) return null;

  const x = chart.timeScale().timeToCoordinate(best.time);
  return x != null && Number.isFinite(x) ? x : null;
}

function tfStyle(tf: string): { stroke: string; fill: string } {
  if (tf === "1d") {
    return { stroke: "#60a5fa", fill: "rgba(96, 165, 250, 0.14)" };
  }
  if (tf === "4h") {
    return { stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.14)" };
  }
  return { stroke: "#38bdf8", fill: "rgba(56, 189, 248, 0.14)" };
}

function boxGeom(
  data: BoxRangePaneData,
  box: BoxRangeChartBox,
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  yMid: number;
  stroke: string;
  fill: string;
} | null {
  if (!shouldDrawBoxOnChart(box.timeframe, data.chartInterval)) return null;

  const leftUnix = Math.min(box.leftTime, box.rightTime);
  const rightUnix = Math.max(box.leftTime, box.rightTime);
  const x1 = resolveTimeX(data.chart, data.series, leftUnix);
  const x2 = resolveTimeX(data.chart, data.series, rightUnix);
  const yTop = data.series.priceToCoordinate(box.top);
  const yBot = data.series.priceToCoordinate(box.bottom);
  const yMid = data.series.priceToCoordinate(box.mid);
  if (x1 == null || x2 == null || yTop == null || yBot == null || yMid == null) {
    return null;
  }

  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(yTop, yBot);
  const bottom = Math.max(yTop, yBot);
  const w = right - left;
  const h = bottom - top;
  if (!(w > 2 && h > 2)) return null;

  const { stroke, fill } = tfStyle(box.timeframe);
  return { left, right, top, bottom, yMid, stroke, fill };
}

function drawBoxLines(
  ctx: CanvasRenderingContext2D,
  data: BoxRangePaneData,
) {
  for (const box of data.boxes) {
    const g = boxGeom(data, box);
    if (!g) continue;
    const { left, right, top, bottom, yMid, stroke } = g;
    const w = right - left;
    const h = bottom - top;
    const label = `${box.timeframe} ${box.state}`;

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w, h);

    const drawHLine = (
      y: number,
      color: string,
      dashed: boolean,
      suffix: string,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = dashed ? 1 : 1.25;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "600 10px system-ui, sans-serif";
      ctx.fillStyle = color;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${label} ${suffix}`, right - 3, y - 2);
    };

    drawHLine(top, stroke, false, "상");
    drawHLine(bottom, stroke, false, "하");
    drawHLine(yMid, "#fb923c", true, "중");
    ctx.restore();
  }
}

class BoxRangeFillRenderer implements IPrimitivePaneRenderer {
  private _data: BoxRangePaneData | null = null;

  update(data: BoxRangePaneData | null) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace((scope) => {
      const data = this._data;
      if (!data?.boxes.length) return;
      const ctx = scope.context;
      for (const box of data.boxes) {
        const g = boxGeom(data, box);
        if (!g) continue;
        ctx.fillStyle = g.fill;
        ctx.fillRect(g.left, g.top, g.right - g.left, g.bottom - g.top);
      }
    });
  }
}

class BoxRangeLineRenderer implements IPrimitivePaneRenderer {
  private _data: BoxRangePaneData | null = null;

  update(data: BoxRangePaneData | null) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace((scope) => {
      const data = this._data;
      if (!data?.boxes.length) return;
      drawBoxLines(scope.context, data);
    });
  }
}

class BoxRangeFillPaneView implements IPrimitivePaneView {
  private _renderer = new BoxRangeFillRenderer();

  constructor(private _source: BoxRangeChartPrimitive) {}

  zOrder() {
    return "bottom" as const;
  }

  renderer() {
    return this._renderer;
  }

  update() {
    this._renderer.update(this._source.viewData());
  }
}

class BoxRangeLinePaneView implements IPrimitivePaneView {
  private _renderer = new BoxRangeLineRenderer();

  constructor(private _source: BoxRangeChartPrimitive) {}

  zOrder() {
    return "normal" as const;
  }

  renderer() {
    return this._renderer;
  }

  update() {
    this._renderer.update(this._source.viewData());
  }
}

export class BoxRangeChartPrimitive implements ISeriesPrimitive<Time> {
  private _boxes: BoxRangeChartBox[] = [];
  private _chartInterval = "1h";
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | undefined;
  private _fillView: BoxRangeFillPaneView;
  private _lineView: BoxRangeLinePaneView;
  private _rangeHandler: (() => void) | null = null;

  constructor() {
    this._fillView = new BoxRangeFillPaneView(this);
    this._lineView = new BoxRangeLinePaneView(this);
  }

  viewData(): BoxRangePaneData | null {
    if (!this._chart || !this._series) return null;
    return {
      chart: this._chart,
      series: this._series,
      boxes: this._boxes,
      chartInterval: this._chartInterval,
    };
  }

  setData(boxes: BoxRangeChartBox[], chartInterval: string) {
    this._boxes = boxes;
    this._chartInterval = chartInterval;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  paneViews() {
    return [this._fillView, this._lineView] as const;
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._rangeHandler = () => this._requestUpdate?.();
    this._chart.timeScale().subscribeVisibleLogicalRangeChange(this._rangeHandler);
    this._chart.timeScale().subscribeVisibleTimeRangeChange(this._rangeHandler);
  }

  detached() {
    if (this._chart && this._rangeHandler) {
      this._chart.timeScale().unsubscribeVisibleLogicalRangeChange(this._rangeHandler);
      this._chart.timeScale().unsubscribeVisibleTimeRangeChange(this._rangeHandler);
    }
    this._rangeHandler = null;
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  updateAllViews() {
    this._fillView.update();
    this._lineView.update();
  }
}

export function createBoxRangeChartPrimitive(): BoxRangeChartPrimitive {
  return new BoxRangeChartPrimitive();
}
