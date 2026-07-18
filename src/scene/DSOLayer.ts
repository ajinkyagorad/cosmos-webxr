// Deep-sky object layer: one THREE.Points cloud, procedural per-type sprite shaders
// (noise nebulae, tinted galaxies, ring planetaries, speckled clusters, shell SNRs),
// all anchored at REAL catalog positions from OpenNGC / Messier.
import * as THREE from "three";
import type { DSO, DSOData } from "../data/types";
import { radecToVec, formatDistancePC, esc, PC_TO_LY } from "../util/astro";
import { DSO_DISTANCE_LY, normalizeDSOKey } from "../data/dsoDistances";
import type { Selectable } from "./Selection";

const TYPE_CODE: Record<string, number> = {
  galaxy: 0, "emission nebula": 1, "planetary nebula": 2,
  "open cluster": 3, "globular cluster": 4, "supernova remnant": 5, other: 6,
};
const TYPE_COLORS: Record<string, THREE.Color> = {
  galaxy: new THREE.Color(0xd8c9a8),
  "emission nebula": new THREE.Color(0xff7da0),
  "planetary nebula": new THREE.Color(0x7dffd4),
  "open cluster": new THREE.Color(0xaac8ff),
  "globular cluster": new THREE.Color(0xfff2cc),
  "supernova remnant": new THREE.Color(0xff9d7d),
  other: new THREE.Color(0xbbbbbb),
};
const TYPE_DEFAULT_SIZE_PC: Record<string, number> = {
  galaxy: 800, "emission nebula": 6, "planetary nebula": 1.2,
  "open cluster": 6, "globular cluster": 25, "supernova remnant": 8, other: 4,
};

export class DSOLayer {
  points: THREE.Points;
  objects: DSO[] = [];
  /** Universe position per object index; null when the object has no real distance (#38). */
  positions: (THREE.Vector3 | null)[] = [];
  sizes: number[] = [];
  /** Resolved distance in light-years per object (catalog or curated table), null = unknown. */
  distLy: (number | null)[] = [];
  /** Objects dropped from rendering because no real distance is known. */
  droppedNoDistance = 0;

  constructor(data: DSOData) {
    const objs = data.objects;
    this.objects = objs;
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const type: number[] = [];
    const seed: number[] = [];
    const v = new THREE.Vector3();
    objs.forEach((o, i) => {
      // Distance: catalog value first, then the curated Messier/NGC table (C12).
      // The catalog name field is zero-padded ("M031") so the fetch-time join
      // missed almost everything — normalize before lookup.
      const dly = o.d ?? DSO_DISTANCE_LY[normalizeDSOKey(o.n)] ?? null;
      this.distLy.push(dly);
      // #38: NEVER place an object at a fake constant radius. OpenNGC is
      // direction-only for most entries; rendering them on a 50 kpc shell made
      // the whole catalog look equidistant. Objects without a real distance
      // (catalog, curated table, or the 2MRS cross-match in dso.json) are not
      // rendered at all.
      if (dly == null) {
        this.positions.push(null);
        this.sizes.push(0);
        this.droppedNoDistance++;
        return;
      }
      const dpc = dly / PC_TO_LY;
      radecToVec(o.ra, o.dec, dpc, v);
      this.positions.push(v.clone());
      pos.push(v.x, v.y, v.z);
      const c = TYPE_COLORS[o.t] ?? TYPE_COLORS.other;
      const dim = o.m !== null ? THREE.MathUtils.clamp(1.3 - o.m / 18, 0.25, 1.15) : 0.6;
      col.push(c.r * dim, c.g * dim, c.b * dim);
      let sizePc = TYPE_DEFAULT_SIZE_PC[o.t] ?? 4;
      if (o.s) {
        // Real angular size at real distance → physical size.
        sizePc = Math.max(2 * dpc * Math.tan(((o.s / 60) * Math.PI) / 360), sizePc * 0.3);
      }
      this.sizes.push(sizePc);
      size.push(sizePc);
      type.push(TYPE_CODE[o.t] ?? 6);
      seed.push(Math.random() * 100);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(col), 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(size), 1));
    geo.setAttribute("aType", new THREE.BufferAttribute(new Float32Array(type), 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(seed), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aType;
        attribute float aSeed;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vType;
        varying float vSeed;
        void main() {
          vColor = aColor; vType = aType; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float mscale = length(vec3(modelViewMatrix[0][0], modelViewMatrix[0][1], modelViewMatrix[0][2]));
          float px = aSize * mscale * uPixelRatio * (700.0 / max(-mv.z, 0.001));
          gl_PointSize = clamp(px, 1.5, 420.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vColor;
        varying float vType;
        varying float vSeed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
          return v;
        }
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0; // 0 center → 1 edge
          float a = 0.0;
          vec3 col = vColor;
          if (vType < 0.5) {
            // Galaxy: elliptical core + faint spiral hint.
            float ang = atan(uv.y, uv.x);
            float spiral = 0.5 + 0.5 * cos(ang * 2.0 - d * 6.0 + vSeed);
            float core = exp(-d * d * 6.0);
            float disk = exp(-d * 2.2) * (0.4 + 0.6 * spiral);
            a = clamp(core * 1.2 + disk * 0.5, 0.0, 1.0) * smoothstep(1.0, 0.85, d);
          } else if (vType < 1.5) {
            // Emission nebula: fbm clouds.
            float n = fbm(uv * 6.0 + vSeed);
            a = smoothstep(0.45, 0.85, n) * smoothstep(1.0, 0.3, d);
            col = mix(vColor, vColor.bgr, fbm(uv * 3.0 - vSeed) * 0.6);
          } else if (vType < 2.5) {
            // Planetary nebula: thin ring + central star.
            float ring = smoothstep(0.12, 0.0, abs(d - 0.55));
            float star = smoothstep(0.2, 0.0, d);
            a = clamp(ring + star, 0.0, 1.0);
          } else if (vType < 3.5) {
            // Open cluster: sparse speckle.
            float n = hash(floor((uv + 0.5) * 14.0));
            float star = step(0.86, n) * smoothstep(0.5, 0.0, d);
            a = star;
          } else if (vType < 4.5) {
            // Globular cluster: dense core + speckle halo.
            float core = exp(-d * d * 4.0);
            float n = hash(floor((uv + 0.5) * 22.0));
            float speck = step(0.7, n) * smoothstep(0.9, 0.2, d) * 0.8;
            a = clamp(core + speck, 0.0, 1.0);
          } else if (vType < 5.5) {
            // SNR: wispy shell.
            float n = fbm(uv * 5.0 + vSeed);
            float shell = smoothstep(0.25, 0.0, abs(d - 0.6 - n * 0.15));
            a = shell * (0.4 + 0.6 * n);
          } else {
            a = smoothstep(1.0, 0.0, d) * 0.7;
          }
          if (a < 0.02) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Only DSOs with a real catalog identity (Messier or common name) become ray-selectable. */
  toSelectables(): Selectable[] {
    const out: Selectable[] = [];
    this.objects.forEach((o, i) => {
      if (!o.cn && !o.n.startsWith("M")) return;
      const p = this.positions[i];
      if (!p) return; // no real distance → not in the cloud (#38)
      out.push({
        id: `dso-${i}`,
        name: o.cn ? `${o.n} (${o.cn})` : o.n,
        kind: "dso",
        position: p,
        // sizes are physical diameters → true radius, so go-to framing (C8) is correct
        radiusWorld: Math.max(this.sizes[i] / 2, 0.25),
        describe: () => describeDSO(o, this.distLy[i]),
      });
    });
    return out;
  }
}

export function describeDSO(o: DSO, distLy?: number | null): string {
  const rows = [`<b>${esc(o.n)}</b>${o.cn ? ` — ${esc(o.cn)}` : ""}`, `Type: ${esc(o.t)}`];
  const d = distLy ?? o.d;
  if (d) rows.push(`Distance: ${formatDistancePC(d / PC_TO_LY)}`);
  if (o.m !== null) rows.push(`Visual magnitude: ${o.m.toFixed(1)}`);
  if (o.s) rows.push(`Angular size: ${o.s.toFixed(1)}′`);
  rows.push(`RA ${o.ra.toFixed(2)}° · Dec ${o.dec.toFixed(2)}° (J2000)`);
  rows.push(`<span class="dim">OpenNGC / Messier catalog · distances SEDS/SIMBAD</span>`);
  return rows.join("<br>");
}
