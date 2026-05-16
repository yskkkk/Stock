export const THEME_STORAGE_KEY = "stock-app-color-theme";

export type ColorMode = "light" | "dark";

export function readStoredTheme(): ColorMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function applyTheme(mode: ColorMode): void {
  const root = document.documentElement;
  if (mode === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
}

export function persistTheme(mode: ColorMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
