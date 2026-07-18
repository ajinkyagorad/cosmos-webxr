// Exoplanet layer: point markers at real host-star positions, colored by discovery method.
import * as THREE from "three";
import type { Exoplanet, ExoplanetData } from "../data/types";
import { radecToVec, formatDistancePC, esc } from "../util/astro";
import type { Selectable } from "./Selection";

export const METHOD_COLORS: Record<string, THREE.Color> = {
  Transit: new THREE.Color(0x4db8ff),
  "Radial Velocity": new THREE.Color(0xffa94d),
  Imaging: new THREE.Color(0xc44dff),
  Microlensing: new THREE.Color(0x6dff9e),
  "Transit Timing Variations": new THREE.Color(0x4dfff0),
  "Eclipse Timing Variations": new THREE.Color(0xffe94d),
  "Astrometry": new THREE.Color(0xff6da8),
};
const DEFAULT_COLOR = new THREE.Color(0xaaaaaa);

export class ExoplanetLayer {
  points: THREE.Points;
  planets: Exoplanet[] = [];
  positions: THREE.Vector3[] = [];

  constructor(data: ExoplanetData) {
    const N = data.planets.length;
    this.planets = data.planets;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const v = new THREE.Vector3();
    data.planets.forEach((p, i) => {
      radecToVec(p.ra, p.dec, p.d, v);
      this.positions.push(v.clone());
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      const c = METHOD_COLORS[p.m] ?? DEFAULT_COLOR;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float mscale = length(vec3(modelViewMatrix[0][0], modelViewMatrix[0][1], modelViewMatrix[0][2]));
          float px = 0.06 * mscale * uPixelRatio * (700.0 / max(-mv.z, 0.001));
          gl_PointSize = clamp(px, 2.0, 10.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float ring = smoothstep(0.5, 0.42, d) - smoothstep(0.34, 0.26, d);
          float dot0 = smoothstep(0.18, 0.0, d);
          float a = clamp(ring + dot0, 0.0, 1.0);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Register every planet as angularly-pickable (registry scan is on-click only). */
  toSelectables(): Selectable[] {
    return this.planets.map((p, i) => ({
      id: `exo-${i}`,
      name: p.n,
      kind: "exoplanet",
      position: this.positions[i],
      radiusWorld: 0.3,
      describe: () => describeExoplanet(p),
    }));
  }
}

export function describeExoplanet(p: Exoplanet): string {
  const rows: string[] = [
    `<b>${esc(p.n)}</b> (host: ${esc(p.h)})`,
    `Distance: ${formatDistancePC(p.d)}`,
    `Discovery: ${p.y ?? "?"} · ${esc(p.m)}`,
  ];
  if (p.r) rows.push(`Radius: ${p.r.toFixed(2)} R⊕`);
  if (p.bm) rows.push(`Mass: ${p.bm.toFixed(2)} M⊕`);
  if (p.p) rows.push(`Orbital period: ${p.p.toFixed(1)} days`);
  if (p.st) rows.push(`Host spectral type: ${esc(p.st)}`);
  const teq = estimateTeq(p);
  if (teq != null) {
    rows.push(`Equilibrium temp: ≈${Math.round(teq)} K ` +
      `<span class="dim">(estimate: solar-type host from spectral class, albedo 0.3)</span>`);
  }
  rows.push(`<span class="dim">NASA Exoplanet Archive</span>`);
  return rows.join("<br>");
}

/** Spectral-class → effective temperature (main sequence, standard values). */
const TEFF_BY_CLASS: Record<string, number> = {
  O: 30000, B: 15000, A: 9000, F: 7000, G: 5800, K: 4800, M: 3200, L: 2300, T: 1300,
};

/**
 * Rough equilibrium temperature estimate (clearly labeled in the UI):
 * host luminosity from spectral class (L ∝ T_eff⁴, R≈R☉), orbital distance from
 * the measured period via Kepler's third law (M from mass–luminosity), then
 * T_eq = 278 K · L^¼ · a^(−½) (Earth-like albedo 0.3, full redistribution).
 */
function estimateTeq(p: Exoplanet): number | null {
  if (!p.st || !p.p) return null;
  const cls = p.st.trim().charAt(0).toUpperCase();
  const teff = TEFF_BY_CLASS[cls];
  if (!teff) return null;
  const L = Math.pow(teff / 5778, 4);       // L☉ (R ≈ R☉ assumption)
  const M = Math.pow(L, 1 / 3.5);           // M☉ (mass–luminosity)
  const aAU = Math.cbrt(M * Math.pow(p.p / 365.25, 2)); // Kepler III
  if (!(aAU > 0)) return null;
  return 278.3 * Math.pow(L, 0.25) / Math.sqrt(aAU);
}
