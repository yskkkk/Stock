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

/** 앱은 라이트 전용 — 저장값이 예전 다크였으면 라이트로 덮어씀 */
export function readStoredTheme(): ColorMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark") {
      localStorage.setItem(THEME_STORAGE_KEY, "light");
    }
  } catch {
    /* ignore */
  }
  return "light";
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

export function persistTheme(_mode?: ColorMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
  } catch {
    /* ignore */
  }
}

/** 항상 라이트 테마 적용 (`_mode` 인자는 기존 호출부 호환용, 무시됨) */
export function applyTheme(_mode?: ColorMode): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", "light");
  applyLightPalette(readStoredLightPalette());
}
