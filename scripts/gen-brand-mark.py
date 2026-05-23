#!/usr/bin/env python3
"""크로마(초록)·회색·체커보드 매트 제거 후 3D YS 로고 PNG 생성."""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "branding" / "ystock-logo-source.png"
OUT_MARK = ROOT / "public" / "branding" / "ystock-logo-mark.png"
OUT_ALPHA = ROOT / "public" / "branding" / "ystock-logo-alpha.png"

OUT_SIZES: list[tuple[Path, int]] = [
    (OUT_MARK, 128),
    (OUT_ALPHA, 1024),
    (ROOT / "public" / "icons" / "icon-32.png", 32),
    (ROOT / "public" / "icons" / "icon-192.png", 192),
    (ROOT / "public" / "icons" / "apple-touch-icon.png", 180),
    (ROOT / "public" / "apple-touch-icon.png", 180),
    (ROOT / "public" / "icons" / "icon-512.png", 512),
    (ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024),
    (ROOT / "android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48),
    (ROOT / "android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72),
    (ROOT / "android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96),
    (ROOT / "android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144),
    (ROOT / "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192),
    (ROOT / "android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png", 48),
    (ROOT / "android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png", 72),
    (ROOT / "android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png", 96),
    (ROOT / "android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png", 144),
    (ROOT / "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png", 192),
    (ROOT / "android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png", 108),
    (ROOT / "android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png", 162),
    (ROOT / "android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png", 216),
    (ROOT / "android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png", 324),
    (ROOT / "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", 432),
]


def is_chroma_green(r: int, g: int, b: int, a: int) -> bool:
    if a < 20:
        return False
    return (
        g >= 85
        and g >= r + 28
        and g >= b + 18
        and r <= 105
        and b <= 145
    )


def is_matte_background(r: int, g: int, b: int, a: int) -> bool:
    if is_chroma_green(r, g, b, a):
        return True
    mx, mn = max(r, g, b), min(r, g, b)
    sat = mx - mn
    lum = (r + g + b) / 3.0
    # 회색 단색 · 체커보드 타일
    if sat <= 55 and 100 <= lum <= 178:
        return True
    if sat <= 32 and 118 <= lum <= 218:
        return True
    return False


def clear_matte(im: Image.Image) -> Image.Image:
    px = im.load()
    w, h = im.size
    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        if not (0 <= x < w and 0 <= y < h) or seen[y][x]:
            return
        if not is_matte_background(*px[x, y]):
            return
        seen[y][x] = True
        q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                if is_matte_background(*px[nx, ny]):
                    seen[ny][nx] = True
                    q.append((nx, ny))

    return im


def crop_opaque(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def save_square(im: Image.Image, size: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = max(2, int(size * 0.08))
    inner = size - 2 * pad
    fitted = im.copy()
    fitted.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    ox = (size - fitted.width) // 2
    oy = (size - fitted.height) // 2
    canvas.paste(fitted, (ox, oy), fitted)
    canvas.save(path, "PNG")


def main() -> None:
    if not SRC.exists():
        print(f"[brand-mark] missing {SRC}", file=sys.stderr)
        sys.exit(1)
    base = Image.open(SRC).convert("RGBA")
    if max(base.size) < 512:
        base = base.resize((1024, 1024), Image.Resampling.LANCZOS)
    elif max(base.size) > 1024:
        base.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    logo = crop_opaque(clear_matte(base))
    for path, sz in OUT_SIZES:
        save_square(logo, sz, path)
    print(f"[brand-mark] ok: {len(OUT_SIZES)} files")


if __name__ == "__main__":
    main()
