import type { CSSProperties, KeyboardEvent } from "react";
import { ENABLE_THEME_MODE_TOGGLE } from "../constants/uiFlags";
import {
  LIGHT_PALETTE_IDS,
  LIGHT_PALETTE_PREVIEW,
  type ColorMode,
  type LightPaletteId,
} from "../lib/theme";
import { ko } from "../i18n/ko";

type AppThemeCornerProps = {
  colorMode: ColorMode;
  lightPalette: LightPaletteId;
  onToggleColorMode: () => void;
  onLightPalette: (id: LightPaletteId) => void;
};

export default function AppThemeCorner({
  colorMode,
  lightPalette,
  onToggleColorMode,
  onLightPalette,
}: AppThemeCornerProps) {
  const themeTitle =
    !ENABLE_THEME_MODE_TOGGLE
      ? ko.app.themeToggleDisabledHint
      : colorMode === "dark"
        ? ko.app.themeUseLight
        : ko.app.themeUseDark;

  const themeLabel =
    colorMode === "dark" ? ko.app.themeSwitchToLight : ko.app.themeSwitchToDark;

  const onModeKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!ENABLE_THEME_MODE_TOGGLE) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleColorMode();
    }
  };

  return (
    <div
      className="app-theme-corner app-theme-corner--top"
      role="region"
      aria-label={ko.app.themeToggleAria}
    >
      <button
        type="button"
        className="app-theme-corner__mode"
        title={themeTitle}
        aria-label={themeTitle}
        disabled={!ENABLE_THEME_MODE_TOGGLE}
        aria-pressed={colorMode === "light"}
        onClick={onToggleColorMode}
        onKeyDown={onModeKeyDown}
      >
        {themeLabel}
        <span className="app-theme-corner__mode-icon" aria-hidden>
          {colorMode === "dark" ? "\u2600" : "\u263E"}
        </span>
      </button>

      {colorMode === "light" ? (
        <div
          className="light-palette-picker light-palette-picker--corner"
          role="group"
          aria-label={ko.app.lightPaletteAria}
        >
          {LIGHT_PALETTE_IDS.map((id, idx) => (
            <button
              key={id}
              type="button"
              className={
                lightPalette === id
                  ? "light-palette-swatch light-palette-swatch--active"
                  : "light-palette-swatch"
              }
              aria-label={`${idx + 1} / ${LIGHT_PALETTE_IDS.length}`}
              aria-pressed={lightPalette === id}
              onClick={() => onLightPalette(id)}
              style={{ "--lp-fill": LIGHT_PALETTE_PREVIEW[id] } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
