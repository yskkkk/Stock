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
  mist: {
    "--bg": "#d8e2eb",
    "--bg-elevated": "#e0e8f1",
    "--surface": "#eaf0f6",
    "--card": "#f4f8fc",
    "--text": "#0f172a",
    "--text-dim": "#3d4f66",
    "--muted": "#526077",
    "--accent": "#0d9488",
    "--card-border": "rgba(15, 23, 42, 0.1)",
    "--scrollbar-track": "#cdd7e4",
    "--scrollbar-thumb": "rgba(71, 85, 105, 0.28)",
  },
  paper: {
    "--bg": "#f0ebe3",
    "--bg-elevated": "#ebe5dc",
    "--surface": "#f5f1ea",
    "--card": "#faf8f4",
    "--text": "#2a2622",
    "--text-dim": "#5a5349",
    "--muted": "#756c62",
    "--accent": "#5a6bb5",
    "--card-border": "rgba(55, 48, 40, 0.1)",
    "--scrollbar-track": "#e0d9cf",
    "--scrollbar-thumb": "rgba(90, 82, 72, 0.26)",
  },
  sage: {
    "--bg": "#e4ebe6",
    "--bg-elevated": "#dce6df",
    "--surface": "#eef4ef",
    "--card": "#f6faf7",
    "--text": "#1e2b24",
    "--text-dim": "#3d5247",
    "--muted": "#5a6e62",
    "--accent": "#2f6f55",
    "--card-border": "rgba(35, 55, 45, 0.1)",
    "--scrollbar-track": "#d2dcd4",
    "--scrollbar-thumb": "rgba(60, 80, 68, 0.26)",
  },
  lavender: {
    "--bg": "#ebe9f3",
    "--bg-elevated": "#e4e1ee",
    "--surface": "#f2f0f8",
    "--card": "#f8f7fc",
    "--text": "#252134",
    "--text-dim": "#4b4668",
    "--muted": "#6a6488",
    "--accent": "#5f4bb0",
    "--card-border": "rgba(45, 38, 70, 0.1)",
    "--scrollbar-track": "#dbd6ea",
    "--scrollbar-thumb": "rgba(75, 70, 110, 0.24)",
  },
  sand: {
    "--bg": "#f2e9df",
    "--bg-elevated": "#ebe1d6",
    "--surface": "#f7f0e8",
    "--card": "#fcf7f1",
    "--text": "#2f241c",
    "--text-dim": "#5c4d42",
    "--muted": "#7a6a5e",
    "--accent": "#8b5f3a",
    "--card-border": "rgba(70, 52, 38, 0.1)",
    "--scrollbar-track": "#e5dcd1",
    "--scrollbar-thumb": "rgba(110, 90, 72, 0.24)",
  },
  dusk: {
    "--bg": "#e2e8f2",
    "--bg-elevated": "#d9e1ec",
    "--surface": "#ecf1f7",
    "--card": "#f5f8fc",
    "--text": "#152238",
    "--text-dim": "#3d4f6a",
    "--muted": "#55657d",
    "--accent": "#3d6ea8",
    "--card-border": "rgba(30, 42, 62, 0.1)",
    "--scrollbar-track": "#d3dbe8",
    "--scrollbar-thumb": "rgba(60, 76, 100, 0.26)",
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
