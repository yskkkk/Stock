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

export function readStoredTheme(): ColorMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
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

function syncMetaThemeColorFromCss(): void {
  const root = document.documentElement;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  try {
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  } catch {
    meta.setAttribute("content", "#0a0e13");
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
  root.style.colorScheme = mode === "light" ? "light" : "dark";
  requestAnimationFrame(() => syncMetaThemeColorFromCss());
}
