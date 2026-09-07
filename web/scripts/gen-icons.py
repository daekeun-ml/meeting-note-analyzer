"""Render the PNG app icons from the brand mark (same geometry as src/components/Logo.tsx).

Run: uv run --with pillow --with numpy python scripts/gen-icons.py
Outputs public/icons/{icon-192,icon-512,icon-512-maskable,apple-touch-icon}.png
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
C0, C1 = np.array([0x5B, 0x8C, 0xFF], dtype=float), np.array([0x7D, 0x5C, 0xFF], dtype=float)
BARS = [(16, 28, 36), (24, 21, 43), (32, 14, 50), (40, 19, 45), (48, 27, 37)]  # x, y1, y2 on a 64-unit grid


def gradient(size: int) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(float)
    t = ((x + y) / (2 * (size - 1)))[..., None]
    rgb = (C0 * (1 - t) + C1 * t).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, np.full((size, size, 1), 255, np.uint8)]), "RGBA")


def render(size: int, *, rounded: bool, pad: float = 0.0) -> Image.Image:
    ss = 4  # supersample for smooth edges
    s = size * ss
    tile = int(s * (1 - 2 * pad))
    off = (s - tile) // 2
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = gradient(tile)
    if rounded:
        mask = Image.new("L", (tile, tile), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile - 1, tile - 1), radius=int(tile * 16 / 60), fill=255)
        img.paste(grad, (off, off), mask)
    else:
        img.paste(gradient(s), (0, 0))
    draw = ImageDraw.Draw(img)
    unit = tile / 64
    w = 5 * unit
    for x, y1, y2 in BARS:
        cx, ya, yb = off + x * unit, off + y1 * unit, off + y2 * unit
        draw.rounded_rectangle((cx - w / 2, ya - w / 2, cx + w / 2, yb + w / 2), radius=w / 2, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
render(192, rounded=True).save(OUT / "icon-192.png")
render(512, rounded=True).save(OUT / "icon-512.png")
render(512, rounded=False, pad=0.0).save(OUT / "icon-512-maskable.png")  # full-bleed; the launcher applies its own mask
render(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png")  # iOS rounds the corners itself
print("icons written to", OUT)
