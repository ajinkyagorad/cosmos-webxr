#!/usr/bin/env python3
"""Fetch the NASA/WMAP 9-year all-sky CMB map and reproject Mollweide -> equirectangular.

Source: Wikimedia Commons "File:WMAP 2012.png" (4096x2048 Mollweide, clean, no
annotations) — NASA/WMAP Science Team, public domain (NASA imagery policy).
The sci.esa.int Planck equirectangular JPEG was removed from scicms (404 as of
2026-07), so WMAP 9yr is the reachable real CMB map.

Output: public/textures/cmb.jpg (2048x1024 equirectangular JPEG).
Magic bytes are verified before any processing. If anything fails, the app
falls back to a procedural 2.725 K noise texture (flagged in the manifest).
"""
import io
import sys
import urllib.request

import numpy as np
from PIL import Image

URL = "https://upload.wikimedia.org/wikipedia/commons/e/ed/WMAP_2012.png"
OUT = "public/textures/cmb.jpg"
W_OUT, H_OUT = 2048, 1024


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "cosmos-webxr/1.0 (educational WebXR app)"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def main() -> int:
    raw = fetch(URL)
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        print("FAIL: not a PNG (magic bytes mismatch)", raw[:8].hex())
        return 1
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    W, H = im.size
    print(f"source OK: {W}x{H} PNG ({len(raw)/1e6:.1f} MB)")
    src = np.asarray(im, dtype=np.float32)

    # Equirectangular output grid: lon in [-pi, pi], lat in [pi/2, -pi/2] (top row = north).
    ys, xs = np.mgrid[0:H_OUT, 0:W_OUT]
    lam = (xs + 0.5) / W_OUT * 2 * np.pi - np.pi          # longitude
    phi = np.pi / 2 - (ys + 0.5) / H_OUT * np.pi          # latitude

    # Mollweide forward: 2t + sin(2t) = pi*sin(phi); Newton solve for theta.
    t = phi.copy()
    for _ in range(12):
        f = 2 * t + np.sin(2 * t) - np.pi * np.sin(phi)
        fp = 2 + 2 * np.cos(2 * t)
        t -= f / np.maximum(fp, 1e-6)
    X = (2 * np.sqrt(2) / np.pi) * lam * np.cos(t)        # [-2sqrt2, 2sqrt2]
    Y = np.sqrt(2) * np.sin(t)                            # [-sqrt2, sqrt2]
    # Normalize: x spans ±2√2 → fraction X/(4√2) + 1/2; y spans ±√2 → 1/2 − Y/(2√2).
    fx = (X / (4 * np.sqrt(2)) + 0.5) * W - 0.5
    fy = (0.5 - Y / (2 * np.sqrt(2))) * H - 0.5

    # Bilinear sample with x wrap (longitude seam) and y clamp.
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    dx = (fx - x0)[..., None]
    dy = (fy - y0)[..., None]
    x0w = x0 % W
    x1w = (x0 + 1) % W
    y0c = np.clip(y0, 0, H - 1)
    y1c = np.clip(y0 + 1, 0, H - 1)
    c00 = src[y0c, x0w]; c10 = src[y0c, x1w]; c01 = src[y1c, x0w]; c11 = src[y1c, x1w]
    out = (c00 * (1 - dx) * (1 - dy) + c10 * dx * (1 - dy) + c01 * (1 - dx) * dy + c11 * dx * dy)

    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    img.save(OUT, quality=88)
    import os
    print(f"wrote {OUT}: {img.size}, {os.path.getsize(OUT)/1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
