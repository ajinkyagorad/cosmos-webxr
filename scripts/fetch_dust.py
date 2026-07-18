#!/usr/bin/env python3
"""
Dust volume pipeline for COSMOS WebXR — mirrors reference/extract_data.py step 1.

Downloads the k3d snapshot of the Leike & Ensslin / Lallement Gaia-based 3D dust
density maps (via sb2580/k3d_dust), extracts the msgpack Volume payload, and writes:

  public/data/dust.bin       uint8 log-encoded density cube (z,y,x) = (81,201,201)
  public/data/dust_meta.json shape/extent/encoding/provenance

The cube stays in GALACTIC Cartesian coordinates (Sun at origin, +X to the Galactic
centre, +Z to the north galactic pole). The app mounts it under a group that carries
the equatorial-J2000 -> galactic rotation, so no resampling is needed.

deps: numpy, msgpack  (managed python: python -m pip install msgpack)
"""
import base64, json, re, sys, urllib.request, zlib
from pathlib import Path
import numpy as np, msgpack

OUT = Path(__file__).resolve().parent.parent / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

URL = "https://raw.githubusercontent.com/sb2580/k3d_dust/main/index.html"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "cosmos-webxr-data-fetch/1.0 (educational)"})
    return urllib.request.urlopen(req, timeout=180).read()

def main():
    print("dust: downloading k3d snapshot of Leike/Lallement maps (~19 MB)...")
    html = get(URL).decode("utf-8", "ignore")
    blobs = re.findall(r"'([A-Za-z0-9+/=]{100000,})'", html)
    if not blobs:
        sys.exit("no base64 blob found in k3d html — upstream format changed?")
    blob = max(blobs, key=len)
    snap = msgpack.unpackb(zlib.decompress(base64.b64decode(blob)), raw=False, strict_map_key=False)
    a = next(o for o in snap["objects"] if o.get("type") == "Volume")["volume"]
    vol = np.frombuffer(a["data"], dtype=a["dtype"]).reshape(a["shape"])  # (81,201,201) = (z,y,x)
    VMIN, VMAX = 0.02, float(vol.max())
    enc = np.round(np.log(np.clip(vol, VMIN, VMAX) / VMIN) / np.log(VMAX / VMIN) * 255).astype(np.uint8)
    (OUT / "dust.bin").write_bytes(enc.tobytes())
    meta = {
        "source": "Leike & Ensslin / Lallement 3D dust maps (via sb2580/k3d_dust k3d snapshot)",
        "url": URL,
        "shape_zyx": [81, 201, 201],
        "extent_pc": {"x": [-1000, 1000], "y": [-1000, 1000], "z": [-400, 400]},
        "frame": "Galactic Cartesian, Sun at origin, +X to Galactic Center, +Z to N gal pole",
        "encoding": "uint8 log-scale: density = vmin*pow(vmax/vmin, value/255)",
        "vmin": VMIN, "vmax": VMAX,
        "units": "relative extinction density",
        "license": "Leike & Ensslin 2020 / Lallement et al. dust maps — cite the underlying papers",
    }
    (OUT / "dust_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"  dust.bin: {enc.nbytes} bytes, vmax={VMAX:.3f}")

if __name__ == "__main__":
    main()
