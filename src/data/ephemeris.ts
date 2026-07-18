// Real-time ephemeris: Keplerian orbital elements (J2000 elements + rates per Julian
// century) from NASA/JPL's published "Keplerian Elements for Approximate Positions of
// the Major Planets" (Solar System Dynamics Group). Kepler's equation is solved per
// evaluation; accuracy is ~arcminutes for the 8 planets over 1800–2050 — exactly the
// right level for a museum-scale solar system.
// Moon: Paul Schlyter's published low-precision lunar theory ("How to compute planetary
// positions", stjarnhimlen.se) with the five largest perturbation terms (~arcminute).
// All outputs are ecliptic J2000; ECLIPTIC_TO_EQUATORIAL_Q rotates into the app's
// equatorial J2000 universe frame (obliquity 23.4392911°), which also puts the galactic
// plane at its true ~60.2° to the ecliptic automatically.
import * as THREE from "three";

const D2R = Math.PI / 180;
/** J2000.0 epoch = JD 2451545.0. */
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86400000;
const DAYS_PER_CENTURY = 36525;

/** Obliquity of the ecliptic at J2000 (23.4392911°) — ecliptic → equatorial rotation. */
export const ECLIPTIC_TO_EQUATORIAL_Q = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0), 23.4392911 * D2R,
);

interface Elements { a: number; e: number; i: number; L: number; lp: number; O: number; }
// [a(AU), e, i(°), L(°), ϖ(°), Ω(°)] at J2000 + rate per Julian century. JPL table 1/2a.
const ELEMENTS: Record<string, [Elements, Elements]> = {
  Mercury: [{ a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.25032350, lp: 77.45779628, O: 48.33076593 },
            { a: 0.00000037, e: 0.00001906, i: -0.00594749, L: 149472.67411175, lp: 0.16047689, O: -0.12534081 }],
  Venus:   [{ a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.97909950, lp: 131.60246718, O: 76.67984255 },
            { a: 0.00000390, e: -0.00004107, i: -0.00078890, L: 58517.81538729, lp: 0.00268329, O: -0.27769418 }],
  Earth:   [{ a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, lp: 102.93768193, O: 0.0 },
            { a: 0.00000562, e: -0.00004392, i: -0.01294668, L: 35999.37244981, lp: 0.32327364, O: 0.0 }],
  Mars:    [{ a: 1.52371034, e: 0.09339410, i: 1.84969142, L: -4.55343205, lp: -23.94362959, O: 49.55953891 },
            { a: 0.00001847, e: 0.00007882, i: -0.00813131, L: 19140.30268499, lp: 0.44441088, O: -0.29257343 }],
  Jupiter: [{ a: 5.20288700, e: 0.04838624, i: 1.30439695, L: 34.39644051, lp: 14.72847983, O: 100.47390909 },
            { a: -0.00011607, e: -0.00013253, i: -0.00183714, L: 3034.74612775, lp: 0.21252668, O: 0.20469106 }],
  Saturn:  [{ a: 9.53667594, e: 0.05386179, i: 2.48599187, L: 49.95424423, lp: 92.59887831, O: 113.66242448 },
            { a: -0.00125060, e: -0.00050991, i: 0.00193609, L: 1222.49362201, lp: -0.41897216, O: -0.28867794 }],
  Uranus:  [{ a: 19.18916464, e: 0.04725744, i: 0.77263783, L: 313.23810451, lp: 170.95427630, O: 74.01692503 },
            { a: -0.00196176, e: -0.00004397, i: -0.00242939, L: 428.48202785, lp: 0.40805281, O: 0.04240589 }],
  Neptune: [{ a: 30.06992276, e: 0.00859048, i: 1.77004347, L: -55.12002969, lp: 44.96476227, O: 131.78422574 },
            { a: 0.00026291, e: 0.00005105, i: 0.00035372, L: 218.45945325, lp: -0.32241464, O: -0.00508664 }],
};

function norm360(x: number): number { return ((x % 360) + 360) % 360; }

function elementsAt(name: string, T: number): Elements {
  const [e0, er] = ELEMENTS[name];
  return {
    a: e0.a + er.a * T, e: e0.e + er.e * T, i: e0.i + er.i * T,
    L: norm360(e0.L + er.L * T), lp: norm360(e0.lp + er.lp * T), O: norm360(e0.O + er.O * T),
  };
}

/** Solve Kepler's equation M = E − e·sinE (radians in/out). */
function solveKepler(M: number, e: number): number {
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 8; k++) {
    const f = E - e * Math.sin(E) - M;
    E -= f / (1 - e * Math.cos(E));
  }
  return E;
}

/** Heliocentric ecliptic J2000 position of a planet (AU) at Julian centuries T since J2000. */
export function planetEclipticAU(name: string, T: number, out = new THREE.Vector3()): THREE.Vector3 {
  const el = elementsAt(name, T);
  const M = (el.L - el.lp) * D2R;
  const w = (el.lp - el.O) * D2R;   // argument of perihelion
  const O = el.O * D2R, i = el.i * D2R;
  const E = solveKepler(M, el.e);
  const xp = el.a * (Math.cos(E) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return out.set(
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    (sw * si) * xp + (cw * si) * yp,
  );
}

/** Points along the planet's full orbit ellipse (ecliptic J2000, AU) for orbit lines. */
export function planetOrbitEclipticAU(name: string, T: number, segments = 240): THREE.Vector3[] {
  const el = elementsAt(name, T);
  const w = (el.lp - el.O) * D2R, O = el.O * D2R, i = el.i * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k < segments; k++) {
    const nu = (k / segments) * 2 * Math.PI;
    const r = (el.a * (1 - el.e * el.e)) / (1 + el.e * Math.cos(nu));
    const xp = r * Math.cos(nu), yp = r * Math.sin(nu);
    pts.push(new THREE.Vector3(
      (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
      (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
      (sw * si) * xp + (cw * si) * yp,
    ));
  }
  return pts;
}

/** Direction of the planet's orbital ascending node Ω in the ecliptic frame (unit vector). */
export function planetNodeAxisEcliptic(name: string, T: number, out = new THREE.Vector3()): THREE.Vector3 {
  const O = elementsAt(name, T).O * D2R;
  return out.set(Math.cos(O), Math.sin(O), 0);
}

/** Julian centuries since J2000 for a JS time (ms). */
export function centuriesSinceJ2000(ms: number): number {
  return (ms - J2000_MS) / MS_PER_DAY / DAYS_PER_CENTURY;
}

/**
 * Geocentric ecliptic position of the Moon (Earth radii) — Schlyter's low-precision
 * lunar theory with the major perturbation terms. Good to a few arcminutes.
 */
export function moonEclipticEarthRadii(ms: number, out = new THREE.Vector3()): THREE.Vector3 {
  const d = (ms - (J2000_MS - 0.5 * MS_PER_DAY)) / MS_PER_DAY; // days since 2000 Jan 0.0 TD
  const N = norm360(125.1228 - 0.0529538083 * d) * D2R;
  const i = 5.1454 * D2R;
  const w = norm360(318.0634 + 0.1643573223 * d) * D2R;
  const a = 60.2666, e = 0.054900;
  const M = norm360(115.3654 + 13.0649929509 * d) * D2R;
  const E = solveKepler(M, e);
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
  // Rotate out of the orbital plane into ecliptic J2000 (standard N,w,i rotation).
  const cwN = Math.cos(N), swN = Math.sin(N);
  const u = v + w; // argument of latitude from node
  const cu = Math.cos(u), su = Math.sin(u), ci = Math.cos(i), si = Math.sin(i);
  const x = r * (cwN * cu - swN * su * ci);
  const y = r * (swN * cu + cwN * su * ci);
  const z = r * (su * si);
  let lon = Math.atan2(y, x);
  let lat = Math.asin(z / r);
  let rr = r;
  // Sun elements for the perturbation arguments.
  const Ms = norm360(356.0470 + 0.9856002585 * d) * D2R;                 // mean anomaly ☉
  const wsun = norm360(282.9404 + 4.70935e-5 * d) * D2R;                 // longitude of perihelion ☉
  const Lsun = Ms + wsun;                                                // mean longitude ☉
  const Lm = N + w + M;                                                  // mean longitude ☾
  const D = Lm - Lsun;                                                   // mean elongation
  const F = Lm - N;                                                      // argument of latitude
  const sin = Math.sin, cos = Math.cos;
  lon += (-1.274 * sin(M - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms)
    - 0.059 * sin(2 * M - 2 * D) - 0.057 * sin(M - 2 * D + Ms)) * D2R;
  lat += (-0.173 * sin(F - 2 * D) - 0.055 * sin(M - F - 2 * D) - 0.046 * sin(M + F - 2 * D)
    + 0.033 * sin(F + 2 * D) + 0.017 * sin(2 * M + F)) * D2R;
  rr += -0.58 * cos(M - 2 * D) - 0.46 * cos(2 * D);
  return out.set(rr * Math.cos(lat) * Math.cos(lon), rr * Math.cos(lat) * Math.sin(lon), rr * Math.sin(lat));
}
