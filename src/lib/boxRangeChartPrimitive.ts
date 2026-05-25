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
  /** 박스 우측을 최신 봉 시각까지 연장(Pine 박스권) */
  extendRightTo: number | null;
};

function tfStyle(tf: string): { stroke: string; fill: string } {
  if (tf === "1d") {
    return { stroke: "#60a5fa", fill: "rgba(96, 165, 250, 0.14)" };
  }
  if (tf === "4h") {
    return { stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.14)" };
  }
  return { stroke: "#38bdf8", fill: "rgba(56, 189, 248, 0.14)" };
}

function coordX(
  chart: IChartApi,
  unixSec: number,
): number | null {
  const x = chart.timeScale().timeToCoordinate(unixSec as Time);
  return x ?? null;
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
  const { chart, series, extendRightTo } = data;
  const rightUnix = Math.max(box.rightTime, extendRightTo ?? box.rightTime);
  const x1 = coordX(chart, box.leftTime);
  const x2 = coordX(chart, rightUnix);
  const yTop = series.priceToCoordinate(box.top);
  const yBot = series.priceToCoordinate(box.bottom);
  const yMid = series.priceToCoordinate(box.mid);
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
  private _extendRightTo: number | null = null;
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
      extendRightTo: this._extendRightTo,
    };
  }

  setData(boxes: BoxRangeChartBox[], extendRightTo: number | null) {
    this._boxes = boxes;
    this._extendRightTo = extendRightTo;
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
