export const THEME_STORAGE_KEY = "stock-app-color-theme";

export type ColorMode = "light" | "dark";

export const LIGHT_PALETTE_STORAGE_KEY = "stock-app-light-palette";

export const LIGHT_PALETTE_IDS = [
  "mist",
  "paper",
  "sage",
  "lavender",
  "sand",
  "dusk",
] as const;

export type LightPaletteId = (typeof LIGHT_PALETTE_IDS)[number];

export function isLightPaletteId(v: string): v is LightPaletteId {
  return (LIGHT_PALETTE_IDS as readonly string[]).includes(v);
}

/** 스와치 미리보기(대표 액센트) */
export const LIGHT_PALETTE_PREVIEW: Record<LightPaletteId, string> = {
  mist: "#0d9488",
  paper: "#5a6bb5",
  sage: "#2f6f55",
  lavender: "#5f4bb0",
  sand: "#8b5f3a",
  dusk: "#3d6ea8",
};

/**
 * 로컬에 저장된 테마가 없을 때의 기본값.
 * `@media (max-width: 900px) and (hover: none) and (pointer: coarse)` 와 동일하게
 * 터치 중심 모바일에서는 라이트(화이트) 모드를 기본으로 한다.
 */
function defaultColorModeWhenUnset(): ColorMode {
  if (typeof window === "undefined") return "dark";
  try {
    if (
      window.matchMedia(
        "(max-width: 900px) and (hover: none) and (pointer: coarse)",
      ).matches
    ) {
      return "light";
    }
  } catch {
    /* ignore */
  }
  return "dark";
}

export function readStoredTheme(): ColorMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return defaultColorModeWhenUnset();
}

export function readStoredLightPalette(): LightPaletteId {
  try {
    const v = localStorage.getItem(LIGHT_PALETTE_STORAGE_KEY);
    if (v && isLightPaletteId(v)) return v;
  } catch {
    /* ignore */
  }
  return "mist";
}

export function applyLightPalette(id: LightPaletteId): void {
  document.documentElement.setAttribute("data-light-palette", id);
}

export function clearLightPaletteAttr(): void {
  document.documentElement.removeAttribute("data-light-palette");
}

export function persistLightPalette(id: LightPaletteId): void {
  try {
    localStorage.setItem(LIGHT_PALETTE_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function persistTheme(mode: ColorMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function applyTheme(mode: ColorMode): void {
  const root = document.documentElement;
  if (mode === "light") {
    root.setAttribute("data-theme", "light");
    applyLightPalette(readStoredLightPalette());
  } else {
    root.removeAttribute("data-theme");
    clearLightPaletteAttr();
  }
}
