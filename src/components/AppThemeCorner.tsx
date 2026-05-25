import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { ENABLE_THEME_MODE_TOGGLE } from "../constants/uiFlags";
import { applyThemeBlend, clearThemeBlend } from "../lib/themeBlend";
import {
  LIGHT_PALETTE_IDS,
  LIGHT_PALETTE_PREVIEW,
  applyLightPalette,
  type ColorMode,
  type LightPaletteId,
} from "../lib/theme";
import { ko } from "../i18n/ko";

const LIGHT_PALETTE_ARIA: Record<LightPaletteId, string> = {
  amber: ko.app.lightPaletteAmber,
  ocean: ko.app.lightPaletteOcean,
  glass: ko.app.lightPaletteGlass,
};

type AppThemeCornerProps = {
  colorMode: ColorMode;
  lightPalette: LightPaletteId;
  onColorModeChange: (mode: ColorMode) => void;
  onLightPalette: (id: LightPaletteId) => void;
};

function ThemeSunIcon() {
  return (
    <svg
      className="app-theme-corner__mode-toggle-svg"
      viewBox="0 0 24 24"
      width={12}
      height={12}
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.2" y1="4.2" x2="6.3" y2="6.3" />
        <line x1="17.7" y1="17.7" x2="19.8" y2="19.8" />
        <line x1="4.2" y1="19.8" x2="6.3" y2="17.7" />
        <line x1="17.7" y1="6.3" x2="19.8" y2="4.2" />
      </g>
    </svg>
  );
}

function ThemeMoonIcon() {
  return (
    <svg
      className="app-theme-corner__mode-toggle-svg"
      viewBox="0 0 24 24"
      width={12}
      height={12}
      aria-hidden
    >
      <path
        d="M18 14.5a6.5 6.5 0 0 1-9-9 7.5 7.5 0 1 0 9 9z"
        fill="currentColor"
      />
    </svg>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** 드래그 중 t≈0.5일 때 0→1→0 (천천히 지날 때만 눈에 띔) */
const THEME_TOGGLE_CENTER_BAND = 0.14;

function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function centerIconOpacityFromT(t: number, dragging: boolean): number {
  if (!dragging) return 0;
  const d = Math.abs(t - 0.5);
  if (d >= THEME_TOGGLE_CENTER_BAND) return 0;
  return smoothstep01(1 - d / THEME_TOGGLE_CENTER_BAND);
}

/** 투명 배경 3D YS — PWA icon-192(사각 매트) 대신 */
const CENTER_EGG_LOGO_SRC = "/branding/ystock-logo-alpha.png?v=23";

export default function AppThemeCorner({
  colorMode,
  lightPalette,
  onColorModeChange,
  onLightPalette,
}: AppThemeCornerProps) {
  const isLight = colorMode === "light";
  const trackRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const thumbWidthRef = useRef(0);
  const dragRef = useRef(false);
  const dragStartModeRef = useRef<ColorMode | null>(null);
  const colorModeRef = useRef(colorMode);
  const [dragging, setDragging] = useState(false);
  const [dragT, setDragT] = useState(() => (isLight ? 0 : 1));
  const [hoverPalette, setHoverPalette] = useState<LightPaletteId | null>(null);
  const centerEggIconSrc = CENTER_EGG_LOGO_SRC;
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    colorModeRef.current = colorMode;
  }, [colorMode]);

  useEffect(() => {
    if (!dragging) setDragT(isLight ? 0 : 1);
  }, [isLight, dragging]);

  const modeFromT = useCallback((t: number): ColorMode => (t >= 0.5 ? "dark" : "light"), []);

  const previewBlendFromT = useCallback(
    (t: number) => {
      applyThemeBlend(t, lightPalette);
    },
    [lightPalette],
  );

  const measureThumbWidth = useCallback(() => {
    const thumb = thumbRef.current;
    if (!thumb) return 0;
    const w = thumb.getBoundingClientRect().width;
    if (w > 0) thumbWidthRef.current = w;
    return thumbWidthRef.current;
  }, []);

  const pointerToT = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return colorModeRef.current === "light" ? 0 : 1;
      const tr = track.getBoundingClientRect();
      const cs = getComputedStyle(track);
      const padL = Number.parseFloat(cs.paddingLeft) || 0;
      const padR = Number.parseFloat(cs.paddingRight) || 0;
      const thumbW = thumbWidthRef.current || measureThumbWidth();
      if (thumbW <= 0) return colorModeRef.current === "light" ? 0 : 1;
      const minLeft = tr.left + padL;
      const maxLeft = tr.right - padR - thumbW;
      const travel = Math.max(1, maxLeft - minLeft);
      const left = Math.min(maxLeft, Math.max(minLeft, clientX - thumbW / 2));
      return clamp01((left - minLeft) / travel);
    },
    [measureThumbWidth],
  );

  const finishPointer = useCallback(
    (clientX: number) => {
      const nextT = pointerToT(clientX);
      dragRef.current = false;
      dragStartModeRef.current = null;
      setDragging(false);
      clearThemeBlend();
      const want = modeFromT(nextT);
      if (want !== colorModeRef.current) onColorModeChange(want);
    },
    [modeFromT, onColorModeChange, pointerToT],
  );

  const onModePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!ENABLE_THEME_MODE_TOGGLE || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    measureThumbWidth();
    dragStartModeRef.current = colorModeRef.current;
    dragRef.current = true;
    setDragging(true);
    const t = pointerToT(e.clientX);
    setDragT(t);
    previewBlendFromT(t);
  };

  const onModePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const t = pointerToT(e.clientX);
    setDragT(t);
    previewBlendFromT(t);
  };

  const onModePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!ENABLE_THEME_MODE_TOGGLE) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!dragRef.current) return;
    finishPointer(e.clientX);
  };

  const onModePointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = false;
    setDragging(false);
    clearThemeBlend();
    const start = dragStartModeRef.current;
    dragStartModeRef.current = null;
    if (start != null) {
      onColorModeChange(start);
      setDragT(start === "light" ? 0 : 1);
    } else {
      setDragT(colorModeRef.current === "light" ? 0 : 1);
    }
  };

  useEffect(
    () => () => {
      clearThemeBlend();
    },
    [],
  );

  const thumbT = dragging ? dragT : isLight ? 0 : 1;
  const previewDark = thumbT >= 0.5;
  const centerEggOpacity = centerIconOpacityFromT(thumbT, dragging);
  const showCenterEggOverlay = dragging && centerEggOpacity > 0.01;

  const themeTitle = !ENABLE_THEME_MODE_TOGGLE
    ? ko.app.themeToggleDisabledHint
    : isLight
      ? ko.app.themeUseDark
      : ko.app.themeUseLight;

  const onModeKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!ENABLE_THEME_MODE_TOGGLE) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onColorModeChange(isLight ? "dark" : "light");
    }
  };

  const previewPalette = useCallback(
    (id: LightPaletteId) => {
      if (!isLight) return;
      setHoverPalette(id);
      applyLightPalette(id);
    },
    [isLight],
  );

  const restoreCommittedPalette = useCallback(() => {
    setHoverPalette(null);
    if (isLight) applyLightPalette(lightPalette);
  }, [isLight, lightPalette]);

  const commitPalette = useCallback(
    (id: LightPaletteId) => {
      setHoverPalette(null);
      onLightPalette(id);
    },
    [onLightPalette],
  );

  useEffect(() => {
    if (!isLight) setHoverPalette(null);
  }, [isLight]);

  return (
    <div
      className="app-theme-corner app-theme-corner--top"
      role="region"
      aria-label={ko.app.themeToggleAria}
    >
      <button
        type="button"
        className={[
          "app-theme-corner__mode-toggle",
          isLight ? "app-theme-corner__mode-toggle--light" : "app-theme-corner__mode-toggle--dark",
          dragging ? "app-theme-corner__mode-toggle--dragging" : "",
          previewDark ? "app-theme-corner__mode-toggle--preview-dark" : "app-theme-corner__mode-toggle--preview-light",
        ]
          .filter(Boolean)
          .join(" ")}
        title={themeTitle}
        aria-label={themeTitle}
        role="switch"
        aria-checked={isLight}
        disabled={!ENABLE_THEME_MODE_TOGGLE}
        onKeyDown={onModeKeyDown}
        onPointerDown={onModePointerDown}
        onPointerMove={onModePointerMove}
        onPointerUp={onModePointerUp}
        onPointerCancel={onModePointerCancel}
        style={{ touchAction: "none" } as CSSProperties}
      >
        <span ref={trackRef} className="app-theme-corner__mode-toggle-track">
          <span
            ref={thumbRef}
            className="app-theme-corner__mode-toggle-thumb"
            aria-hidden
            style={
              {
                "--mode-thumb-translate": String(thumbT * 100),
              } as CSSProperties
            }
          />
          <span className="app-theme-corner__mode-toggle-icon app-theme-corner__mode-toggle-icon--sun">
            <ThemeSunIcon />
          </span>
          <span className="app-theme-corner__mode-toggle-icon app-theme-corner__mode-toggle-icon--moon">
            <ThemeMoonIcon />
          </span>
        </span>
      </button>

      {showCenterEggOverlay && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-corner__center-egg-overlay"
              aria-hidden
              style={
                {
                  "--center-egg-opacity": String(centerEggOpacity),
                } as CSSProperties
              }
            >
              <img
                src={centerEggIconSrc}
                alt=""
                className="app-theme-corner__center-egg-icon"
                draggable={false}
                decoding="async"
              />
            </div>,
            document.body,
          )
        : null}

      {((!dragging && isLight) || (dragging && thumbT < 0.5)) ? (
        <div
          ref={pickerRef}
          className="light-palette-picker light-palette-picker--corner"
          role="group"
          aria-label={ko.app.lightPaletteAria}
          onPointerLeave={() => restoreCommittedPalette()}
          onFocusOut={(e) => {
            if (pickerRef.current?.contains(e.relatedTarget as Node)) return;
            restoreCommittedPalette();
          }}
        >
          {LIGHT_PALETTE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={[
                "light-palette-swatch",
                lightPalette === id ? "light-palette-swatch--active" : "",
                hoverPalette === id ? "light-palette-swatch--hover" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={LIGHT_PALETTE_ARIA[id]}
              title={LIGHT_PALETTE_ARIA[id]}
              aria-pressed={lightPalette === id}
              onPointerEnter={() => previewPalette(id)}
              onFocus={() => previewPalette(id)}
              onClick={() => commitPalette(id)}
              data-lp={id}
              style={{ "--lp-fill": LIGHT_PALETTE_PREVIEW[id] } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
