import { useEffect } from "react";
import type { ChartDrawMode } from "../chartDrawTypes";
import { CHART_DRAW_RAY_TOOL_ENABLED } from "../chartDrawTypes";
import { ko } from "../i18n/ko";

export interface ChartDrawToolbarButtonsProps {
  drawMode: ChartDrawMode;
  onDrawModeChange: (m: ChartDrawMode) => void;
  onClearAll: () => void;
  magnetEnabled?: boolean;
  onMagnetChange?: (next: boolean) => void;
  /** 예: `chart-draw-toolbar--inline` — 상단 툴바에 붙일 때 */
  className?: string;
}

/** TradingView 스타일에 가까운 단색 선 아이콘 (글자 대신) */
function IconCursor() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor">
      <path d="M12 3v18M3 12h18" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconHLine() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor">
      <path d="M4 12h16" strokeWidth="1.75" />
      <path d="M4 8v2M4 14v2M20 8v2M20 14v2" strokeWidth="1.5" />
    </svg>
  );
}

function IconRay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor">
      <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
      <path d="M9 15L20 4" strokeWidth="1.75" />
      <path d="M20 4h-5M20 4v5" strokeWidth="1.5" />
    </svg>
  );
}

function IconMagnet({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor">
      <path
        d="M7 10c0-3 2.5-5.5 5-5.5S17 7 17 10v6h-3v-6c0-1.1-.9-2-2-2s-2 .9-2 2v6H7v-6z"
        strokeWidth="1.5"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.22 : 0}
      />
      <path d="M6 16h12" strokeWidth="1.75" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2z" strokeWidth="1.5" />
      <path d="M6 9h12l-1 12H7L6 9z" strokeWidth="1.5" />
      <path d="M10 12v6M14 12v6" strokeWidth="1.5" />
    </svg>
  );
}

export default function ChartDrawToolbarButtons({
  drawMode,
  onDrawModeChange,
  onClearAll,
  magnetEnabled = false,
  onMagnetChange,
  className,
}: ChartDrawToolbarButtonsProps) {
  useEffect(() => {
    if (!CHART_DRAW_RAY_TOOL_ENABLED && drawMode === "ray") {
      onDrawModeChange("cursor");
    }
  }, [drawMode, onDrawModeChange]);

  const rootClass = ["chart-draw-toolbar", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      role="toolbar"
      aria-label={ko.crypto.drawToolbarAria}
    >
      <button
        type="button"
        className={
          drawMode === "cursor"
            ? "chart-draw-btn chart-draw-btn--active chart-draw-btn--icon"
            : "chart-draw-btn chart-draw-btn--icon"
        }
        aria-label={ko.crypto.drawCursor}
        title={ko.crypto.drawCursor}
        aria-pressed={drawMode === "cursor"}
        onClick={() => onDrawModeChange("cursor")}
      >
        <span className="chart-draw-btn__icon">
          <IconCursor />
        </span>
      </button>
      <button
        type="button"
        className={
          drawMode === "hline"
            ? "chart-draw-btn chart-draw-btn--active chart-draw-btn--icon"
            : "chart-draw-btn chart-draw-btn--icon"
        }
        aria-label={ko.crypto.drawHLine}
        title={ko.crypto.drawHLine}
        aria-pressed={drawMode === "hline"}
        onClick={() => onDrawModeChange("hline")}
      >
        <span className="chart-draw-btn__icon">
          <IconHLine />
        </span>
      </button>
      <button
        type="button"
        disabled={!CHART_DRAW_RAY_TOOL_ENABLED}
        className={
          drawMode === "ray"
            ? "chart-draw-btn chart-draw-btn--active chart-draw-btn--icon"
            : "chart-draw-btn chart-draw-btn--icon"
        }
        aria-label={ko.crypto.drawRay}
        title={
          CHART_DRAW_RAY_TOOL_ENABLED ? ko.crypto.drawRay : ko.crypto.drawRayDisabled
        }
        aria-pressed={drawMode === "ray"}
        onClick={() => {
          if (CHART_DRAW_RAY_TOOL_ENABLED) onDrawModeChange("ray");
        }}
      >
        <span className="chart-draw-btn__icon">
          <IconRay />
        </span>
      </button>
      {onMagnetChange ? (
        <>
          <span className="chart-draw-toolbar__sep" aria-hidden />
          <button
            type="button"
            className={
              magnetEnabled
                ? "chart-draw-btn chart-draw-btn--active chart-draw-btn--magnet chart-draw-btn--icon"
                : "chart-draw-btn chart-draw-btn--magnet chart-draw-btn--icon"
            }
            aria-pressed={magnetEnabled}
            aria-label={ko.crypto.drawMagnetAria}
            title={ko.crypto.drawMagnetAria}
            onClick={() => onMagnetChange(!magnetEnabled)}
          >
            <span className="chart-draw-btn__icon">
              <IconMagnet active={magnetEnabled} />
            </span>
          </button>
        </>
      ) : null}
      <span className="chart-draw-toolbar__sep" aria-hidden />
      <button
        type="button"
        className="chart-draw-btn chart-draw-btn--icon"
        aria-label={ko.crypto.drawClear}
        title={ko.crypto.drawClear}
        onClick={onClearAll}
      >
        <span className="chart-draw-btn__icon">
          <IconTrash />
        </span>
      </button>
    </div>
  );
}
