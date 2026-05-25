export const THEME_STORAGE_KEY = "stock-app-color-theme";

export type ColorMode = "light" | "dark";

export const LIGHT_PALETTE_STORAGE_KEY = "stock-app-light-palette";

export const LIGHT_PALETTE_IDS = ["amber", "ocean", "forest"] as const;

export type LightPaletteId = (typeof LIGHT_PALETTE_IDS)[number];

/** 예전 6종 팔레트 id → 신규 3종 */
const LEGACY_LIGHT_PALETTE_MAP: Record<string, LightPaletteId> = {
  sand: "amber",
  paper: "amber",
  mist: "ocean",
  dusk: "ocean",
  sage: "forest",
  lavender: "forest",
  slate: "forest",
};

export function isLightPaletteId(v: string): v is LightPaletteId {
  return (LIGHT_PALETTE_IDS as readonly string[]).includes(v);
}

/** 스와치 미리보기(대표 액센트) */
export const LIGHT_PALETTE_PREVIEW: Record<LightPaletteId, string> = {
  amber: "#f97316",
  ocean: "#1d4ed8",
  forest: "#16a34a",
};

/** 로컬에 저장된 테마가 없을 때 — 라이트(화이트) 모드 */
function defaultColorModeWhenUnset(): ColorMode {
  return "light";
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
    if (v) {
      if (isLightPaletteId(v)) return v;
      const mapped = LEGACY_LIGHT_PALETTE_MAP[v];
      if (mapped) return mapped;
    }
  } catch {
    /* ignore */
  }
  return "ocean";
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
  /* 폼·네이티브 UI — 앱 테마와 동일(다크에서 흰 입력창 방지) */
  root.style.colorScheme = mode === "light" ? "light" : "dark";
  if (mode === "light") {
    root.setAttribute("data-theme", "light");
    applyLightPalette(readStoredLightPalette());
  } else {
    root.removeAttribute("data-theme");
    clearLightPaletteAttr();
  }
}
