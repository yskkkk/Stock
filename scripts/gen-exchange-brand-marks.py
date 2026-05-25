#!/usr/bin/env python3
"""토스·빗썸 앱 아이콘 — 가장자리 흰/검 매트 플러드 제거 후 투명 PNG."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

JOBS: list[tuple[Path, Path, str]] = [
    (
        ROOT / "public" / "branding" / "bithumb-app-icon.png",
        ROOT / "public" / "branding" / "bithumb-mark-alpha.png",
        "white",
    ),
    (
        ROOT / "public" / "branding" / "toss-app.png",
        ROOT / "public" / "branding" / "toss-mark-alpha.png",
        "black",
    ),
]


def is_white_matte(r: int, g: int, b: int, a: int) -> bool:
    if a < 16:
        return True
    lum = (r + g + b) / 3.0
    chroma = max(r, g, b) - min(r, g, b)
    return lum >= 228 and chroma <= 42


def is_black_matte(r: int, g: int, b: int, a: int) -> bool:
    if a < 16:
        return True
    return r <= 32 and g <= 32 and b <= 32 and max(r, g, b) <= 40


def flood_clear(im: Image.Image, is_bg) -> Image.Image:
    px = im.load()
    w, h = im.size
    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if not (0 <= x < w and 0 <= y < h) or seen[y][x]:
            return
        if not is_bg(*px[x, y]):
            return
        seen[y][x] = True
        q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                if is_bg(*px[nx, ny]):
                    seen[ny][nx] = True
                    q.append((nx, ny))

    return im


def crop_and_pad_square(im: Image.Image, pad_ratio: float = 0.08) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    cropped = im.crop(bbox)
    cw, ch = cropped.size
    side = max(cw, ch)
    pad = max(2, int(side * pad_ratio))
    out = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    ox = (out.width - cw) // 2
    oy = (out.height - ch) // 2
    out.paste(cropped, (ox, oy), cropped)
    return out


def process(src: Path, out: Path, mode: str) -> None:
    is_bg = is_white_matte if mode == "white" else is_black_matte
    im = Image.open(src).convert("RGBA")
    im = flood_clear(im, is_bg)
    im = crop_and_pad_square(im)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "PNG")
    print(f"wrote {out.relative_to(ROOT)} ({im.size[0]}x{im.size[1]})")


def main() -> int:
    for src, out, mode in JOBS:
        if not src.is_file():
            print(f"missing: {src}", file=__import__("sys").stderr)
            return 1
        process(src, out, mode)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
