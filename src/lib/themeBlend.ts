import {
  applyLightPalette,
  clearLightPaletteAttr,
  type LightPaletteId,
} from "./theme";

/** 드래그 중 페이지 톤 보간 — CSS 변수만 덮어씀 */
export const THEME_BLEND_CSS_VARS = [
  "--bg",
  "--bg-elevated",
  "--surface",
  "--card",
  "--text",
  "--text-dim",
  "--muted",
  "--accent",
  "--card-border",
  "--scrollbar-track",
  "--scrollbar-thumb",
] as const;

type ThemeBlendVar = (typeof THEME_BLEND_CSS_VARS)[number];
type Rgba = { r: number; g: number; b: number; a: number };

const DARK_THEME_VARS: Record<ThemeBlendVar, string> = {
  "--bg": "#0e1319",
  "--bg-elevated": "#151b24",
  "--surface": "#1a222d",
  "--card": "#1c2532",
  "--text": "#f1f5f9",
  "--text-dim": "#aeb9cc",
  "--muted": "#8b9aac",
  "--accent": "#5eead4",
  "--card-border": "rgba(148, 163, 184, 0.1)",
  "--scrollbar-track": "#151b24",
  "--scrollbar-thumb": "rgba(148, 163, 184, 0.22)",
};

const LIGHT_PALETTE_VARS: Record<
  LightPaletteId,
  Record<ThemeBlendVar, string>
> = {
  amber: {
    "--bg": "#ffe4cc",
    "--bg-elevated": "#ffd4ad",
    "--surface": "#fff0e0",
    "--card": "#fff8f0",
    "--text": "#2a1408",
    "--text-dim": "#6b3d1f",
    "--muted": "#8f5230",
    "--accent": "#f97316",
    "--card-border": "rgba(124, 45, 18, 0.12)",
    "--scrollbar-track": "#ffd9b8",
    "--scrollbar-thumb": "rgba(180, 83, 9, 0.32)",
  },
  ocean: {
    "--bg": "#cfe3ff",
    "--bg-elevated": "#b8d4ff",
    "--surface": "#e3efff",
    "--card": "#f0f7ff",
    "--text": "#0c1a3d",
    "--text-dim": "#1e3a8a",
    "--muted": "#3b5cb8",
    "--accent": "#1d4ed8",
    "--card-border": "rgba(30, 64, 175, 0.12)",
    "--scrollbar-track": "#b8d4ff",
    "--scrollbar-thumb": "rgba(37, 99, 235, 0.32)",
  },
  glass: {
    "--bg": "#d8e2ec",
    "--bg-elevated": "#eef2f7",
    "--surface": "#f4f7fa",
    "--card": "#f8fafc",
    "--text": "#1e293b",
    "--text-dim": "#475569",
    "--muted": "#64748b",
    "--accent": "#5b8fb9",
    "--card-border": "rgba(255, 255, 255, 0.72)",
    "--scrollbar-track": "#dce4ed",
    "--scrollbar-thumb": "rgba(100, 116, 139, 0.35)",
  },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function parseColor(input: string): Rgba | null {
  const s = input.trim();
  const hex = s.match(/^#([\da-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const n = Number.parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
      a,
    };
  }
  const rgb = s.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] != null ? Number(rgb[4]) : 1,
    };
  }
  return null;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpCssColor(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const r = lerpChannel(a.r, b.r, t);
  const g = lerpChannel(a.g, b.g, t);
  const bl = lerpChannel(a.b, b.b, t);
  const alpha = a.a + (b.a - a.a) * t;
  if (alpha >= 0.999) return `rgb(${r}, ${g}, ${bl})`;
  return `rgba(${r}, ${g}, ${bl}, ${Math.round(alpha * 1000) / 1000})`;
}

/** t=0 라이트, t=1 다크 — 마커 위치에 따라 페이지 톤 보간 */
export function applyThemeBlend(t: number, lightPalette: LightPaletteId): void {
  const root = document.documentElement;
  const mix = clamp01(t);
  const light = LIGHT_PALETTE_VARS[lightPalette];
  root.setAttribute("data-theme-blend-active", "");
  if (mix >= 0.5) {
    root.removeAttribute("data-theme");
    clearLightPaletteAttr();
  } else {
    root.setAttribute("data-theme", "light");
    applyLightPalette(lightPalette);
  }
  for (const name of THEME_BLEND_CSS_VARS) {
    root.style.setProperty(name, lerpCssColor(light[name], DARK_THEME_VARS[name], mix));
  }
  root.style.setProperty("--card-bg", root.style.getPropertyValue("--card"));
  root.style.setProperty("--surface-2", root.style.getPropertyValue("--surface"));
}

export function clearThemeBlend(): void {
  const root = document.documentElement;
  root.removeAttribute("data-theme-blend-active");
  for (const name of THEME_BLEND_CSS_VARS) {
    root.style.removeProperty(name);
  }
  root.style.removeProperty("--card-bg");
  root.style.removeProperty("--surface-2");
}
