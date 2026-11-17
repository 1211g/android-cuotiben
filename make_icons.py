# -*- coding: utf-8 -*-
"""Generate all app icons from the provided 3D clay source image.

Previous-version composition (restored after the "centered tile + gray
margin" experiment was reverted): crop the cream rounded square itself out
of the source, let it fill the whole icon canvas, then apply a rounded
mask with CREAM-filled corners.  The magnifier / card artwork therefore
fills the frame with no gray margin.

  * PWA "any" + Android launcher: same recipe at every size.
  * PWA "maskable": the rounded tile scaled into the central 80% safe
    zone on a CREAM plate.

Run: python make_icons.py
"""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "icons", "source-icon.jpg")
OUT = os.path.join(HERE, "icons")
RES = os.path.join(HERE, "android", "res")

CREAM = (250, 247, 236)
# Measured bounds of the cream rounded square inside the 2048x2048 source.
CROP = (352, 346, 1698, 1702)

_src = Image.open(SRC).convert("RGB")
_tile = _src.crop(CROP)
_w, _h = _tile.size
_s = min(_w, _h)
# Center-crop to a square before scaling (cover_square).
SQ = _tile.crop(((_w - _s) // 2, (_h - _s) // 2,
                 (_w - _s) // 2 + _s, (_h - _s) // 2 + _s))


def make_any(size):
    """Tile fills the canvas; rounded mask with CREAM corners."""
    tile = SQ.resize((size, size), Image.LANCZOS)
    out = Image.new("RGB", (size, size), CREAM)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(0.235 * size), fill=255)
    out.paste(tile, (0, 0), mask)
    return out


def make_maskable(size=512):
    """Rounded tile inside the central 80% safe zone on a CREAM plate."""
    inner = int(size * 0.8)
    tile = make_any(inner)
    out = Image.new("RGB", (size, size), CREAM)
    out.paste(tile, ((size - inner) // 2, (size - inner) // 2))
    return out


def make_launcher(size):
    return make_any(size)


# ---- PWA ----
make_any(192).save(os.path.join(OUT, "icon-192.png"))
make_any(512).save(os.path.join(OUT, "icon-512.png"))
make_maskable(512).save(os.path.join(OUT, "icon-maskable.png"))

# ---- Android launcher (all densities) ----
densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for density, size in densities.items():
    d = os.path.join(RES, "mipmap-" + density)
    os.makedirs(d, exist_ok=True)
    make_launcher(size).save(os.path.join(d, "ic_launcher.png"))

print("icons restored to previous version: PWA 192/512/maskable + Android %s"
      % ", ".join(densities))
print("recipe: CROP %s, cover_square, radius int(0.235*size), CREAM %s corners"
      % (CROP, CREAM))
