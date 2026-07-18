// Astronomy math + formatting helpers.
import * as THREE from "three";

export const D2R = Math.PI / 180;
export const PC_TO_LY = 3.26156;
export const AU_IN_PC = 1 / 206264.806;
export const C_M_S = 299792458;
export const PC_IN_KM = 3.0856775814913673e13;

/** RA/Dec (degrees) + distance → equatorial J2000 Cartesian (same convention as data pipeline). */
export function radecToVec(raDeg: number, decDeg: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
  const ra = raDeg * D2R, dec = decDeg * D2R;
  const cd = Math.cos(dec);
  return out.set(dist * cd * Math.cos(ra), dist * Math.sin(dec), dist * cd * Math.sin(ra));
}

/**
 * Rotation taking GALACTIC Cartesian coordinates into our equatorial J2000 frame.
 * This is Rᵀ where R is the standard J2000 equatorial→galactic rotation used by the
 * Milky Way Atlas data pipeline. The dust volume (galactic cube) is mounted under a
 * group carrying this quaternion, so no resampling of the 3D texture is needed.
 */
export const GALACTIC_TO_EQUATORIAL_Q = (() => {
  const R = [
    -0.0548755604, -0.8734370902, -0.4838350155,
    0.4941094279, -0.4448296300, 0.7469822445,
    -0.8676661490, -0.1980763734, 0.4559837762,
  ];
  // Row-major R; transpose = inverse (orthonormal).
  const m = new THREE.Matrix4().set(
    R[0], R[3], R[6], 0,
    R[1], R[4], R[7], 0,
    R[2], R[5], R[8], 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
})();

/** Approximate blackbody/spectral color from B−V color index. */
export function colorFromCI(ci: number, out = new THREE.Color()): THREE.Color {
  // Clamp B-V to a sane stellar range [-0.4, 2.0]
  const t = THREE.MathUtils.clamp((ci + 0.4) / 2.4, 0, 1);
  // Piecewise ramp: blue-white → white → yellow → orange-red
  const stops = [
    new THREE.Color(0x9db4ff), // O/B blue
    new THREE.Color(0xf8f7ff), // A/F white
    new THREE.Color(0xfff4e0), // G yellow-ish
    new THREE.Color(0xffd2a1), // K orange
    new THREE.Color(0xffb56c), // M red-orange
  ];
  const f = t * (stops.length - 1);
  const i = Math.min(Math.floor(f), stops.length - 2);
  return out.copy(stops[i]).lerp(stops[i + 1], f - i);
}

/** Format a speed in pc/s (our world units) into human units, using local frame scale. */
export function formatSpeed(unitsPerSec: number, kmPerUnit: number): { value: string; sub: string } {
  const mps = unitsPerSec * kmPerUnit * 1000;
  if (mps < 1e-3) return { value: "0 m/s", sub: "stationary" };
  const cFrac = mps / C_M_S;
  const fmt = (v: number, unit: string) => `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(2)} ${unit}`;
  if (cFrac >= 1) return { value: `${cFrac >= 1000 ? cFrac.toExponential(2) : cFrac.toFixed(1)} c`, sub: `${fmt(mps / 1000, "km/s")}` };
  if (mps >= 1e9) return { value: fmt(mps / 1e9, "Gm/s"), sub: `${(cFrac * 100).toFixed(1)}% c` };
  if (mps >= 1e6) return { value: fmt(mps / 1e6, "Mm/s"), sub: `${(cFrac * 100).toFixed(2)}% c` };
  if (mps >= 1e3) return { value: fmt(mps / 1e3, "km/s"), sub: mps > 1e4 ? `${(cFrac * 100).toFixed(3)}% c` : "sublight" };
  return { value: fmt(mps, "m/s"), sub: "sublight" };
}

/** Format a distance in parsecs into a nice string. */
export function formatDistancePC(pc: number): string {
  if (pc < 0.001) {
    const au = pc / AU_IN_PC;
    if (au < 0.01) return `${(au * 149597870.7).toExponential(2)} km`;
    return `${au.toFixed(au < 10 ? 3 : 1)} AU`;
  }
  const ly = pc * PC_TO_LY;
  if (ly < 10000) return `${ly.toFixed(ly < 100 ? 1 : 0)} ly`;
  if (ly < 1e6) return `${(ly / 1000).toFixed(1)} kly`;
  return `${(ly / 1e6).toFixed(2)} Mly`;
}

/** Escape user-provided text for safe innerHTML insertion. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
