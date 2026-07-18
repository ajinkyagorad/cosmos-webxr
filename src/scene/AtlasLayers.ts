// Milky Way Atlas data layers (real catalogs, see public/data/manifest.json):
//   DustVolume ......... Leike/Lallement 3D dust density cube (raymarched 3D texture)
//   CepheidLayer ....... Skowron+2019 classical Cepheids — the measured disk incl. warp
//   GlobularLayer ...... Harris/LVDB globular clusters — the galactic halo
//   LocalGroupLayer .... LVDB dwarf galaxies + M31/M33 with real rhalf, M_V, ellipticity, PA
//   ConstellationLayer . Stellarium modern figures as true-3D HIP→HIP segments
// All point data is equatorial J2000 pc (converted at pipeline time); the dust cube is
// galactic and mounted under a group carrying the equatorial↔galactic rotation.
import * as THREE from "three";
import type { DustMeta, BinMeta, GalaxyData, ConstellationData } from "../data/types";
import { GALACTIC_TO_EQUATORIAL_Q, formatDistancePC, esc } from "../util/astro";
import type { Selectable } from "./Selection";

/* ---------------- dust volume (real Leike/Lallement cube) ---------------- */

export class DustVolume {
  group = new THREE.Group();          // galactic frame (quaternion = Rᵀ)
  mesh: THREE.Mesh;
  uniforms: {
    uMap: { value: THREE.Data3DTexture };
    uSteps: { value: number };
    uDensity: { value: number };
    uCut: { value: number };
  };

  constructor(meta: DustMeta, buffer: ArrayBuffer) {
    this.group.name = "dust-volume";
    this.group.quaternion.copy(GALACTIC_TO_EQUATORIAL_Q); // galactic cube → equatorial universe
    const [DZ, DY, DX] = meta.shape_zyx;
    const tex = new THREE.Data3DTexture(new Uint8Array(buffer), DX, DY, DZ);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    this.uniforms = {
      uMap: { value: tex },
      uSteps: { value: 110 },
      uDensity: { value: 1.6 },
      uCut: { value: 0.22 },
    };
    // Raymarched density cube (Milky Way Atlas shader, ported verbatim).
    const volMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      glslVersion: THREE.GLSL3,
      transparent: true, depthWrite: false, side: THREE.BackSide,
      vertexShader: /* glsl */ `
        out vec3 vOrigin; out vec3 vDir;
        void main(){
          mat4 invMV = inverse(modelViewMatrix);
          vOrigin = (invMV * vec4(0.0,0.0,0.0,1.0)).xyz;
          vDir = position - vOrigin;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        precision highp sampler3D;
        in vec3 vOrigin; in vec3 vDir;
        out vec4 fragColor;
        uniform sampler3D uMap;
        uniform float uSteps, uDensity, uCut;
        vec2 boxHit(vec3 ro, vec3 rd){
          vec3 inv = 1.0/rd;
          vec3 t0 = (vec3(-0.5)-ro)*inv, t1 = (vec3(0.5)-ro)*inv;
          vec3 tmin = min(t0,t1), tmax = max(t0,t1);
          return vec2(max(max(tmin.x,tmin.y),tmin.z), min(min(tmax.x,tmax.y),tmax.z));
        }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        vec3 ramp(float t){
          vec3 c1 = vec3(0.055,0.10,0.28), c2 = vec3(0.10,0.42,0.55);
          vec3 c3 = vec3(0.98,0.52,0.16),  c4 = vec3(1.00,0.93,0.80);
          if(t < 0.45) return mix(c1,c2, t/0.45);
          if(t < 0.78) return mix(c2,c3,(t-0.45)/0.33);
          return mix(c3,c4,(t-0.78)/0.22);
        }
        void main(){
          vec3 rd = normalize(vDir);
          vec2 hit = boxHit(vOrigin, rd);
          if(hit.x > hit.y) discard;
          float t = max(hit.x, 0.0), tEnd = hit.y, n = uSteps;
          float dt = 1.74 / n;
          t += dt * hash(gl_FragCoord.xy);
          vec3 acc = vec3(0.0); float alpha = 0.0;
          for(int i=0;i<256;i++){
            if(t > tEnd || alpha > 0.985 || float(i) >= n) break;
            vec3 p = vOrigin + rd*t + 0.5;
            float s = texture(uMap, p).r;
            float d = smoothstep(uCut, 1.0, s);
            if(d > 0.001){
              float a = 1.0 - exp(-d*d * uDensity * dt * 60.0);
              acc += (1.0-alpha) * a * ramp(d) * (0.35 + 1.9*d);
              alpha += (1.0-alpha) * a;
            }
            t += dt;
          }
          if(alpha < 0.003) discard;
          fragColor = vec4(acc, alpha);
        }`,
    });
    const EX = meta.extent_pc;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), volMat);
    this.mesh.scale.set(EX.x[1] - EX.x[0], EX.y[1] - EX.y[0], EX.z[1] - EX.z[0]);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Faint frame box so the 2 kpc survey volume stays orientable.
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(EX.x[1] - EX.x[0], EX.y[1] - EX.y[0], EX.z[1] - EX.z[0])),
      new THREE.LineBasicMaterial({ color: 0x3d5f8a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending }),
    );
    frame.renderOrder = 10;
    this.group.add(frame);
  }

  /** Fewer raymarch steps in XR (Quest GPU budget). */
  setXRMode(xr: boolean) {
    this.uniforms.uSteps.value = xr ? 72 : 110;
  }
}

/* ---------------- shared sized-point shader (pc-size × model scale) ---------------- */

function sizedPointsMaterial(maxPx: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uCamUni: { value: new THREE.Vector3() },  // camera, universe-local pc (#52)
      uDimMode: { value: 0 },                   // 0 none · 1 realistic · 2 artificial
      uDimD0: { value: 1e6 },                   // per-layer reference distance (pc)
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      uniform vec3 uCamUni;
      uniform float uDimMode;
      uniform float uDimD0;
      varying vec3 vColor;
      float dimFactor(vec3 pos) {
        if (uDimMode < 0.5) return 1.0;
        float d = max(length(pos - uCamUni), 1e-6);
        if (uDimMode < 1.5) return clamp((uDimD0 / d) * (uDimD0 / d), 0.02, 1.0);
        return 1.0 / (1.0 + pow(d / uDimD0, 1.5));
      }
      void main() {
        vColor = aColor * dimFactor(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float mscale = length(vec3(modelViewMatrix[0][0], modelViewMatrix[0][1], modelViewMatrix[0][2]));
        float px = aSize * mscale * uPixelRatio * (700.0 / max(-mv.z, 0.001));
        gl_PointSize = clamp(px, 1.2, ${maxPx.toFixed(1)});
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q) * 2.0;
        // Soft gaussian that reaches ~0 AT the sprite edge — no discard cliff.
        // (#49: the old exp(-4.5 r²) + hard discard at a=0.02 left a visible
        // edge, and at the few-pixel clamp each sprite read as a little square.)
        float a = exp(-r * r * 5.0) - 0.0067; // exp(-5) at r=1 → 0
        a = max(a, 0.0) * 0.9;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * 1.4, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function interleavedToAttributes(buf: Float32Array, stride: number) {
  const n = Math.floor(buf.length / stride);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = buf[i * stride]; pos[i * 3 + 1] = buf[i * stride + 1]; pos[i * 3 + 2] = buf[i * stride + 2];
  }
  return { n, pos };
}

/* ---------------- Cepheids (Skowron+2019): the measured disk, incl. the warp ---------------- */

export class CepheidLayer {
  points: THREE.Points;
  positions: THREE.Vector3[] = [];

  constructor(meta: BinMeta, buf: Float32Array) {
    const { n, pos } = interleavedToAttributes(buf, 4);
    const col = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const young = new THREE.Color(0x9fc8ff), old = new THREE.Color(0xffb36b);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.positions.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
      const age = Math.max(buf[i * 4 + 3], 1e-3);
      const t = THREE.MathUtils.clamp(Math.log10(age / 20) / Math.log10(20), 0, 1);
      c.copy(young).lerp(old, t);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      siz[i] = 12; // pc — supergiant markers tracing the disk
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
    this.points = new THREE.Points(geo, sizedPointsMaterial(6));
    this.points.frustumCulled = false;
    void meta;
  }

  toSelectables(): Selectable[] {
    // Only a couple of representative picks — the layer is a population, not a catalog browser.
    return [];
  }
}

/* ---------------- Globular clusters (Harris/LVDB): the halo ---------------- */

export class GlobularLayer {
  points: THREE.Points;
  positions: THREE.Vector3[] = [];
  private mvs: number[] = [];

  constructor(meta: BinMeta, buf: Float32Array) {
    const { n, pos } = interleavedToAttributes(buf, 4);
    const col = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const c = new THREE.Color(0xffe3b0);
    for (let i = 0; i < n; i++) {
      this.positions.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
      const MV = buf[i * 4 + 3];
      this.mvs.push(MV);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      siz[i] = 22 * Math.pow(10, -0.12 * (Math.max(MV, -11) + 7)); // brighter = larger swarm
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
    this.points = new THREE.Points(geo, sizedPointsMaterial(8));
    this.points.frustumCulled = false;
    void meta;
  }

  /** Halo clusters are landmarks/destinations (named ones registered via landmarks.json). */
  describeAt(i: number): string {
    const p = this.positions[i];
    const d = p.length();
    return `Globular cluster<br>M_V ≈ ${this.mvs[i].toFixed(1)}<br>Distance: ${formatDistancePC(d)}<br><span class="dim">Harris / LVDB</span>`;
  }
}

/* ---------------- Local Group / Local Volume galaxies (LVDB + M31/M33) ---------------- */

export class LocalGroupLayer {
  points: THREE.Points;
  galaxies: GalaxyData["galaxies"];

  constructor(data: GalaxyData) {
    this.galaxies = data.galaxies;
    const NL = data.galaxies.length;
    const lpos = new Float32Array(NL * 3), lsiz = new Float32Array(NL), lalp = new Float32Array(NL),
      lell = new Float32Array(NL), lang = new Float32Array(NL), lcol = new Float32Array(NL * 3);
    const c = new THREE.Color();
    for (let i = 0; i < NL; i++) {
      const g = data.galaxies[i];
      lpos[i * 3] = g.pos[0]; lpos[i * 3 + 1] = g.pos[1]; lpos[i * 3 + 2] = g.pos[2];
      lsiz[i] = g.rh * 2;
      lalp[i] = THREE.MathUtils.clamp(0.16 + (-g.MV - 7) * 0.05, 0.10, 0.9);
      lell[i] = g.ell ?? 0.25;
      lang[i] = (g.pa ?? 0) * Math.PI / 180;
      // bright majors slightly blue-white (star-forming disks), faint dwarfs warm (old stars)
      const t = THREE.MathUtils.clamp((-g.MV - 8) / 12, 0, 1);
      c.setRGB(1.0, 0.93 - 0.05 * (1 - t), 0.82 + 0.14 * t);
      lcol[i * 3] = c.r; lcol[i * 3 + 1] = c.g; lcol[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(lpos, 3));
    geo.setAttribute("psize", new THREE.BufferAttribute(lsiz, 1));
    geo.setAttribute("alp", new THREE.BufferAttribute(lalp, 1));
    geo.setAttribute("ell", new THREE.BufferAttribute(lell, 1));
    geo.setAttribute("ang", new THREE.BufferAttribute(lang, 1));
    geo.setAttribute("gcol", new THREE.BufferAttribute(lcol, 3));
    // Oriented core+envelope sprites (Milky Way Atlas shader — sizes are real half-light radii).
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uBright: { value: 1 }, uMinPx: { value: 2 }, uProjH: { value: 700 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, uBoost: { value: 1 },
        uCamUni: { value: new THREE.Vector3() }, uDimMode: { value: 0 }, uDimD0: { value: 1e6 }, // #52
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float psize; attribute float alp; attribute float ell; attribute float ang; attribute vec3 gcol;
        varying float vA; varying float vE; varying float vAng; varying vec3 vCol;
        uniform float uProjH, uBright, uMinPx, uPixelRatio, uBoost;
        uniform vec3 uCamUni; uniform float uDimMode, uDimD0;
        float dimFactor(vec3 pos) {
          if (uDimMode < 0.5) return 1.0;
          float d = max(length(pos - uCamUni), 1e-6);
          if (uDimMode < 1.5) return clamp((uDimD0 / d) * (uDimD0 / d), 0.02, 1.0);
          return 1.0 / (1.0 + pow(d / uDimD0, 1.5));
        }
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float d = max(-mv.z, 1e-6);
          float mscale = length(vec3(modelViewMatrix[0][0], modelViewMatrix[0][1], modelViewMatrix[0][2]));
          float px = psize * mscale / d * uProjH * uPixelRatio;
          px = max(px, uBoost * 7.0 * uPixelRatio);          // galaxy boost: visibility floor
          vA = clamp(alp * uBright * clamp(px/2.0, 0.3, 1.4), 0.0, 1.0);
          vA = max(vA, uBoost * 0.30);                       // boost: brightness floor
          vA *= dimFactor(position);                         // #52 distance dimming
          vE = ell; vAng = ang; vCol = gcol;
          gl_PointSize = clamp(px*1.6, uMinPx, 500.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vE; varying float vAng; varying vec3 vCol;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float ca = cos(vAng), sa = sin(vAng);
          vec2 r = vec2(q.x*ca - q.y*sa, q.x*sa + q.y*ca);   // rotate by position angle
          r.y /= max(1.0 - vE, 0.18);                        // measured flattening
          float rr = dot(r,r)*4.0;
          float core = exp(-rr*9.0);                          // concentrated core
          float env  = exp(-rr*1.7);                          // faint envelope
          float a = (0.62*core + 0.38*env) * vA;
          if(a < 0.012) discard;
          gl_FragColor = vec4(vCol*(1.1+1.6*core), a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Galaxy boost (C11): distance-compensated brightness/size floor so majors never vanish. */
  setBoost(on: boolean): void {
    ((this.points.material as THREE.ShaderMaterial).uniforms.uBoost as { value: number }).value = on ? 1 : 0;
  }

  /** #52: distance dimming — camera position (universe-local pc) + mode 0/1/2. */
  setDimming(camUni: THREE.Vector3, mode: number): void {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    (u.uCamUni.value as THREE.Vector3).copy(camUni);
    u.uDimMode.value = mode;
  }

  toSelectables(): Selectable[] {
    return this.galaxies.map((g, i) => ({
      id: `lg-${i}`,
      name: g.name || `LVDB dwarf #${i}`,
      kind: "galaxy",
      position: new THREE.Vector3(g.pos[0], g.pos[1], g.pos[2]),
      radiusWorld: Math.max(g.rh, 20),
      describe: () =>
        `<b>${esc(g.name || "Dwarf galaxy")}</b><br>Absolute mag M_V: ${g.MV.toFixed(1)}<br>` +
        `Half-light radius: ${g.rh.toLocaleString()} pc<br>Distance: ${formatDistancePC(Math.hypot(g.pos[0], g.pos[1], g.pos[2]))}` +
        `<br>Ellipticity: ${g.ell.toFixed(2)} · PA ${g.pa.toFixed(0)}°<br><span class="dim">Local Volume Database${g.host === "LG" ? " + catalog values" : ""}</span>`,
    }));
  }
}

/* ---------------- constellations: real HIP-to-HIP segments in true 3D ---------------- */

export class ConstellationLayer {
  lines: THREE.LineSegments;
  names: ConstellationData["names"];

  constructor(data: ConstellationData) {
    this.names = data.names;
    const arr = new Float32Array(data.segs.length * 6);
    data.segs.forEach((sg, i) => {
      arr.set([sg[0][0], sg[0][1], sg[0][2], sg[1][0], sg[1][1], sg[1][2]], i * 6);
    });
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(arr, 3)),
      new THREE.LineBasicMaterial({ color: 0x6fb8e8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }),
    );
    this.lines.renderOrder = 2;
    this.lines.frustumCulled = false;
    this.lines.visible = false; // off by default
  }

  /** Label anchors at constellation centroids (shown in a star-field zoom window). */
  getLabelAnchors(): { name: string; object: THREE.Object3D; minLog: number; maxLog: number }[] {
    return this.names.map((n) => {
      const o = new THREE.Object3D();
      o.position.set(n.pos[0], n.pos[1], n.pos[2]);
      return { name: n.name, object: o, minLog: -4.7, maxLog: 0.5 };
    });
  }
}


/* ---------------- 2MRS (Huchra+ 2012): large-scale structure to ~300 Mpc ---------------- */

/**
 * 2MASS Redshift Survey — 42.7k galaxies with redshift distances (cz/H0,
 * H0 = 70 km/s/Mpc; peculiar velocities make individual distances approximate
 * inside ~30 Mpc — see manifest). Equatorial J2000 pc, same convention as the
 * star catalog. Marker size grows with distance so the cosmic web stays legible
 * at the ~100 Mpc zoom band; K-band magnitude sets brightness. D17.
 */
export class TwoMRSLayer {
  points: THREE.Points;

  constructor(meta: BinMeta, buf: Float32Array) {
    const { n, pos } = interleavedToAttributes(buf, 4);
    const col = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const base = new THREE.Color(0xd9c4a5); // warm pale — old stellar populations
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const distPc = Math.sqrt(x * x + y * y + z * z);
      const k = buf[i * 4 + 3];
      // K-band luminosity proxy: brighter (lower mag) → brighter marker.
      const lum = THREE.MathUtils.clamp(1.25 - k / 14, 0.18, 1.0);
      c.copy(base).multiplyScalar(lum);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      // ~constant angular size, but big enough that sprites are smooth glows, not
      // pixel-quantized squares (#49); ±20% jitter breaks the uniform-beads look.
      siz[i] = THREE.MathUtils.clamp(distPc * 0.012, 2e4, 3e6) * (0.85 + ((i * 2654435761) % 1000) / 1000 * 0.35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
    this.points = new THREE.Points(geo, sizedPointsMaterial(14));
    (this.points.material as THREE.ShaderMaterial).uniforms.uDimD0.value = 5e7; // #52 ref: 50 Mpc
    this.points.frustumCulled = false;
    void meta;
  }

  /** #52: distance dimming — camera position (universe-local pc) + mode 0/1/2. */
  setDimming(camUni: THREE.Vector3, mode: number): void {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    (u.uCamUni.value as THREE.Vector3).copy(camUni);
    u.uDimMode.value = mode;
  }

  toSelectables(): Selectable[] {
    return []; // population layer — selection stays on the named catalogs
  }
}
