# -*- coding: utf-8 -*-
"""Generate all app icons from the minimal notebook source image.

Composition
-----------
The source is an open-book + pencil illustration on a white background.  We
measure the non-white content bounds, then take a *centered square crop* that
trims the excess white padding while keeping the whole graphic with a small,
even breathing room (8% of the square on the graphic's binding/horizontal
sides).  Because the book is wider than it is tall, the remaining vertical
whitespace is simply the natural padding of the wide artwork inside a square.

  * PWA "any" + Android launcher: the cropped square fills the canvas, with a
    rounded mask whose corners are filled with the sampled background colour
    (white).
  * PWA "maskable": the rounded tile is scaled into the central 80% safe zone
    on a white plate.

Output structure (filenames, sizes, densities, maskable safe zone) is kept
identical to the previous generator.

Run: python make_icons.py
"""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "icons", "source-icon.jpg")
OUT = os.path.join(HERE, "icons")
RES = os.path.join(HERE, "android", "res")

# Breathing room kept on the binding (horizontal) sides of the wide graphic,
# expressed as a fraction of the final square.  Within the requested 6-10%.
MARGIN = 0.08
# A pixel counts as artwork when it is at least this much darker than white.
CONTENT_THRESHOLD = 12


def measure_background(im):
    """Robust background colour from the four 5x5 corner patches (median)."""
    w, h = im.size
    px = im.load()
    samples = []
    for x0, y0 in ((0, 0), (w - 5, 0), (0, h - 5), (w - 5, h - 5)):
        for y in range(y0, y0 + 5):
            for x in range(x0, x0 + 5):
                samples.append(px[x, y])
    # Median per channel rejects single-pixel JPEG specks.
    return tuple(sorted(c[i] for c in samples)[len(samples) // 2]
                 for i in range(3))


def measure_content_bbox(im, threshold=CONTENT_THRESHOLD):
    """Bounding box (l, t, r, b) of all non-background pixels."""
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if (255 - min(r, g, b)) > threshold:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    return (minx, miny, maxx + 1, maxy + 1)


_src = Image.open(SRC).convert("RGB")
BG = measure_background(_src)
BX = measure_content_bbox(_src)
bw, bh = BX[2] - BX[0], BX[3] - BX[1]
cx, cy = (BX[0] + BX[2]) / 2.0, (BX[1] + BX[3]) / 2.0

# Square side that leaves MARGIN on each side of the graphic's longer axis.
side = int(round(max(bw, bh) / (1 - 2 * MARGIN)))
side = min(side, min(_src.size))          # never exceed the source image
half = side // 2
left = max(0, min(int(round(cx - half)), _src.width - side))
top = max(0, min(int(round(cy - half)), _src.height - side))
CROP = (left, top, left + side, top + side)

SQ = _src.crop(CROP)


def make_any(size):
    """Cropped square fills the canvas; rounded mask with BG-coloured corners."""
    tile = SQ.resize((size, size), Image.LANCZOS)
    out = Image.new("RGB", (size, size), BG)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(0.235 * size), fill=255)
    out.paste(tile, (0, 0), mask)
    return out


def make_maskable(size=512):
    """Rounded tile inside the central 80% safe zone on a BG plate."""
    inner = int(size * 0.8)
    tile = make_any(inner)
    out = Image.new("RGB", (size, size), BG)
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

print("measured content bbox: %s (content %dx%d)" % (BX, bw, bh))
print("background colour: %s" % (BG,))
print("crop rectangle: %s (square %dx%d, margin %.0f%%)"
      % (CROP, side, side, MARGIN * 100))
print("generated: PWA 192/512/maskable + Android %s"
      % ", ".join(densities))
