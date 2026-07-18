#!/usr/bin/env python3
"""Cross-match OpenNGC galaxies (dso.json) against 2MRS (2mrs.bin) to recover
REAL radial distances and eliminate the constant-radius shell artifact (#38).

OpenNGC carries RA/Dec but almost no distances. 2MRS (Huchra+ 2012) has
42,724 galaxies with redshift distances out to 300 Mpc in the same equatorial
J2000 Cartesian frame (see scripts/fetch_2mrs.py). Every bright NGC/IC galaxy
should appear in 2MRS, so an angular nearest-neighbour match assigns a real
distance to most catalog galaxies.

Match rule: type == "galaxy" (2MRS contains only galaxies), nearest 2MRS
object within 1.5 arcmin on the sky. Matched objects get `d` (light-years)
and `ds: "2MRS"`. Nothing is fabricated: unmatched objects keep d = null and
the renderer no longer places them at a fake constant radius.

Idempotent: re-running re-derives every 2MRS-sourced distance from scratch.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
TOL_ARCMIN = 1.5
PC_TO_LY = 3.26156


def main() -> int:
    meta = json.loads((DATA / "2mrs.meta.json").read_text())
    raw = (DATA / "2mrs.bin").read_bytes()
    n = meta["count"]
    stride = meta["stride"]
    arr = np.frombuffer(raw, dtype=np.float32).reshape(n, stride)[:, :3].astype(np.float64)
    dist = np.linalg.norm(arr, axis=1)
    ok = dist > 0
    unit = arr[ok] / dist[ok, None]
    dist_ok = dist[ok]
    print(f"2MRS: {ok.sum()} usable galaxies, {dist_ok.min()/1e6:.2f}-{dist_ok.max()/1e6:.1f} Mpc")

    dso_path = DATA / "dso.json"
    dso = json.loads(dso_path.read_text())
    objs = dso["objects"]

    # Wipe previous 2MRS-sourced distances so re-runs are clean.
    wiped = 0
    for o in objs:
        if o.get("ds") == "2MRS":
            o["d"] = None
            o["ds"] = None
            wiped += 1
    if wiped:
        print(f"reset {wiped} previous 2MRS matches")

    cos_tol = math.cos(math.radians(TOL_ARCMIN / 60.0))
    gal_idx = [i for i, o in enumerate(objs) if o["t"] == "galaxy"]
    print(f"DSO galaxies to match: {len(gal_idx)} (tolerance {TOL_ARCMIN} arcmin)")

    # Unit vectors for all DSO galaxies.
    ra = np.array([objs[i]["ra"] for i in gal_idx], dtype=np.float64)
    dec = np.array([objs[i]["dec"] for i in gal_idx], dtype=np.float64)
    ra_r = np.radians(ra)
    dec_r = np.radians(dec)
    cd = np.cos(dec_r)
    dirs = np.stack([cd * np.cos(ra_r), np.sin(dec_r), cd * np.sin(ra_r)], axis=1)

    matched = 0
    seps = []
    CHUNK = 256
    for start in range(0, len(gal_idx), CHUNK):
        block = dirs[start:start + CHUNK]          # (B,3)
        dots = block @ unit.T                       # (B,N)
        j = np.argmax(dots, axis=1)
        best = dots[np.arange(len(block)), j]
        hit = best >= cos_tol
        for b in np.nonzero(hit)[0]:
            oi = gal_idx[start + b]
            if objs[oi].get("d") is not None:
                continue  # keep the catalog's own distance over the 2MRS one
            d_pc = float(dist_ok[j[b]])
            objs[oi]["d"] = round(d_pc * PC_TO_LY, 1)
            objs[oi]["ds"] = "2MRS"
            matched += 1
            sep = math.degrees(math.acos(min(1.0, float(best[b])))) * 60.0
            seps.append(sep)

    print(f"matched: {matched} / {len(gal_idx)} DSO galaxies")
    if seps:
        seps_a = np.array(seps)
        print(f"separation arcmin: median {np.median(seps_a):.3f}, "
              f"p95 {np.percentile(seps_a, 95):.3f}, max {seps_a.max():.3f}")

    # Sanity: M31/M33 distances if matched.
    for o in objs:
        if o["n"] in ("M031", "M033") or (o.get("cn") or "") in ("Andromeda Galaxy", "Triangulum Galaxy"):
            d = o.get("d")
            print(f"check {o['n']} ({o.get('cn')}): d={d} ly"
                  + (f" = {d/PC_TO_LY/1e6:.3f} Mpc" if d else ""))

    dso["fields"]["d"] = "distance ly (catalog, curated table, or 2MRS redshift via match_dso_2mrs.py)"
    dso["fields"]["ds"] = "distance source tag, '2MRS' when from Huchra+ 2012 cross-match"
    dso_path.write_text(json.dumps(dso, separators=(",", ":")))
    print(f"wrote {dso_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
