#!/usr/bin/env python3
"""Fetch the 2MRS catalog (Huchra+ 2012, J/ApJS/199/26 table3) via the VizieR
TSV endpoint and convert to the app's binary point format.

Output: public/data/2mrs.bin  — Float32 interleaved [x, y, z, Ktmag], pc in the
        same equatorial Cartesian convention as the star catalog (radecToVec).
        public/data/2mrs.meta.json — { count, stride, fields, maxDistMpc }.

Distance: cz / H0 (H0 = 70 km/s/Mpc). Peculiar velocities make individual
cz-distances approximate inside ~30 Mpc — noted in the manifest; positions are
published redshifts, not fabricated. Galaxies beyond 300 Mpc or without a
redshift are dropped.
"""
import io
import json
import math
import os
import struct
import sys
import urllib.request

URL = ("https://vizier.cds.unistra.fr/viz-bin/asu-tsv"
       "?-source=J/ApJS/199/26/table3&-out=RAJ2000,DEJ2000,Ktmag,cz&-out.max=unlimited")
H0 = 70.0          # km/s/Mpc
MAX_MPC = 300.0
BIN = "public/data/2mrs.bin"
META = "public/data/2mrs.meta.json"


def radec_to_vec(ra_deg: float, dec_deg: float, r: float):
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    cd = math.cos(dec)
    # Matches src/util/astro radecToVec: y up = Dec, x/z the RA plane (z positive).
    return (r * cd * math.cos(ra), r * math.sin(dec), r * cd * math.sin(ra))


def main() -> int:
    req = urllib.request.Request(URL, headers={"User-Agent": "cosmos-webxr/1.0 (educational WebXR app)"})
    with urllib.request.urlopen(req, timeout=600) as r:
        text = r.read().decode("utf-8", "replace")
    rows = []
    in_header = True
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        if in_header:
            # First non-# lines are the TSV column header + unit row; data starts after.
            if line.startswith("RAJ2000"):
                in_header = False
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            # Some TSVs are whitespace-separated
            parts = line.split()
            if len(parts) < 4:
                continue
        try:
            ra = float(parts[0]); dec = float(parts[1])
        except ValueError:
            continue  # header/unit rows
        kmag = None
        try:
            kmag = float(parts[2])
        except ValueError:
            pass
        try:
            cz = float(parts[3])
        except (ValueError, IndexError):
            continue  # no redshift → dropped
        dmpc = cz / H0
        if dmpc <= 0.5 or dmpc > MAX_MPC:
            continue
        x, y, z = radec_to_vec(ra, dec, dmpc * 1e6)
        rows.append((x, y, z, kmag if kmag is not None and kmag < 90 else 12.0))

    with open(BIN, "wb") as f:
        for r in rows:
            f.write(struct.pack("<4f", *r))
    meta = {
        "count": len(rows),
        "stride": 4,
        "fields": ["x_pc", "y_pc", "z_pc", "Ktmag"],
        "maxDistMpc": MAX_MPC,
        "h0": H0,
        "source": "2MRS (Huchra+ 2012, J/ApJS/199/26 table3) via VizieR asu-tsv",
    }
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"2MRS: {len(rows)} galaxies -> {BIN} ({os.path.getsize(BIN)/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
