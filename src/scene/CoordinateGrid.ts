// Coordinate grid with three switchable styles (#37):
//   mode 0  cartesian   — 3-axis lattice in the band's reference frame
//   mode 1  spherical   — concentric shells: parallels + meridians at each band radius
//   mode 2  cylindrical — polar rings + spokes in the band plane (the C7 original)
// Bands by zoom (log of universe scale):
//   log > 0.5   → solar-system grid, AU rings, ecliptic plane, centered on the Sun
//   −3 … 0.5    → local-stellar grid, ly rings, galactic plane, centered on the Sun
//   ≤ −3        → galactic grid, kpc rings, galactic plane, centered on the real GC
// Radii deliberately span wide so at least one grid element sits at a sensible
// size at every zoom inside the band (#37: grid "missing" at some scales).
// All geometry lives in the universe group so it scales/rotates with everything else.
// Toggle: settings "layerGrid"; style: settings "gridMode" (0/1/2).
import * as THREE from "three";
import { GALACTIC_CENTER_PC } from "./MilkyWay";
import { WORLD_PER_AU } from "./SolarSystem";
import { ECLIPTIC_TO_EQUATORIAL_Q } from "../data/ephemeris";
import { radecToVec } from "../util/astro";

const GALACTIC_NORMAL_V = radecToVec(192.86, 27.13, 1).normalize();

type Band = "solar" | "stellar" | "galactic" | "none";

export class CoordinateGrid {
  group = new THREE.Group();
  private band: Band = "none";
  private builtExagg = -1;
  private builtMode = -1;

  constructor() {
    this.group.name = "coordinate-grid";
    this.group.visible = false;
  }

  /** Called every frame; rebuilds only when the band, mode, or orbit exaggeration changes. */
  update(logScale: number, orbitExaggeration: number, mode: number): void {
    const band: Band = logScale > 0.5 ? "solar" : logScale <= -3 ? "galactic" : "stellar";
    if (band === this.band && mode === this.builtMode &&
      (band !== "solar" || orbitExaggeration === this.builtExagg)) return;
    this.band = band;
    this.builtMode = mode;
    this.builtExagg = orbitExaggeration;
    this.rebuild(orbitExaggeration, mode);
  }

  private clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (o as unknown as THREE.Line).material as THREE.Material | undefined;
        if (mat) mat.dispose();
        const sp = o as THREE.Sprite;
        if (sp.isSprite) {
          (sp.material.map as THREE.Texture | null)?.dispose();
          sp.material.dispose();
        }
      });
    }
  }

  private rebuild(orbitExaggeration: number, mode: number): void {
    this.clear();
    let center: THREE.Vector3, normal: THREE.Vector3, radii: number[], unit: (r: number) => string;
    if (this.band === "solar") {
      const au = [1, 2, 4, 8, 16, 32];
      center = new THREE.Vector3();
      // Rings are drawn in the ecliptic XY plane, then tilted to the equatorial frame
      // exactly like the orbit lines.
      normal = new THREE.Vector3(0, 0, 1).applyQuaternion(ECLIPTIC_TO_EQUATORIAL_Q);
      radii = au.map((a) => a * WORLD_PER_AU * orbitExaggeration);
      unit = (r) => `${(r / (WORLD_PER_AU * orbitExaggeration)).toFixed(0)} AU`;
    } else if (this.band === "stellar") {
      const ly = [4, 16, 64, 256];
      center = new THREE.Vector3(); // the Sun is the universe-local origin
      normal = GALACTIC_NORMAL_V;
      radii = ly.map((l) => l / 3.26156);
      unit = (r) => `${(r * 3.26156).toFixed(0)} ly`;
    } else {
      const kpc = [0.5, 1, 2, 4, 8, 16, 32];
      center = GALACTIC_CENTER_PC.clone();
      normal = GALACTIC_NORMAL_V;
      radii = kpc.map((k) => k * 1000);
      unit = (r) => r < 1000 ? `${(r * 3.26156).toFixed(0)} ly` : `${(r / 1000).toFixed(0)} kpc`;
    }
    // In-plane orthonormal basis (u, v) with plane normal n.
    const n = normal.clone().normalize();
    const u = Math.abs(n.y) < 0.9
      ? new THREE.Vector3(0, 1, 0).cross(n).normalize()
      : new THREE.Vector3(1, 0, 0).cross(n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    const verts: number[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const p = (r: number, t: number, out: THREE.Vector3) =>
      out.copy(center).addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const circle = (r: number, cu: THREE.Vector3, cv: THREE.Vector3, SEG = 72) => {
      for (let s = 0; s < SEG; s++) {
        const t0 = (s / SEG) * Math.PI * 2, t1 = ((s + 1) / SEG) * Math.PI * 2;
        a.copy(center).addScaledVector(cu, Math.cos(t0) * r).addScaledVector(cv, Math.sin(t0) * r);
        b.copy(center).addScaledVector(cu, Math.cos(t1) * r).addScaledVector(cv, Math.sin(t1) * r);
        seg(a, b);
      }
    };

    if (mode === 1) {
      // ---- spherical: parallels + meridians on each shell ----
      for (const r of radii) {
        for (const latDeg of [0, -30, 30, -60, 60]) {
          const lat = THREE.MathUtils.degToRad(latDeg);
          const rr = r * Math.cos(lat);
          // parallel circle: loop center offset along n by r·sin(lat)
          const c0 = center.clone().addScaledVector(n, r * Math.sin(lat));
          for (let s = 0; s < 64; s++) {
            const t0 = (s / 64) * Math.PI * 2, t1 = ((s + 1) / 64) * Math.PI * 2;
            a.copy(c0).addScaledVector(u, Math.cos(t0) * rr).addScaledVector(v, Math.sin(t0) * rr);
            b.copy(c0).addScaledVector(u, Math.cos(t1) * rr).addScaledVector(v, Math.sin(t1) * rr);
            seg(a, b);
          }
        }
        // meridians every 30° (circles through the ±n poles of the shell)
        for (let mIdx = 0; mIdx < 12; mIdx++) {
          const t = (mIdx / 12) * Math.PI * 2;
          const mu = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t));
          for (let s = 0; s < 64; s++) {
            const t0 = (s / 64) * Math.PI * 2, t1 = ((s + 1) / 64) * Math.PI * 2;
            a.copy(center).addScaledVector(mu, Math.cos(t0) * r).addScaledVector(n, Math.sin(t0) * r);
            b.copy(center).addScaledVector(mu, Math.cos(t1) * r).addScaledVector(n, Math.sin(t1) * r);
            seg(a, b);
          }
        }
      }
    } else if (mode === 0) {
      // ---- cartesian lattice: spacing = 2nd radius, extent = max radius ----
      const spacing = radii[1] ?? radii[0];
      const E = radii[radii.length - 1];
      const steps = Math.round(E / spacing);
      const at = (du: number, dv: number, dn: number, out: THREE.Vector3) =>
        out.copy(center).addScaledVector(u, du).addScaledVector(v, dv).addScaledVector(n, dn);
      for (let i = -steps; i <= steps; i++) {
        for (let j = -steps; j <= steps; j++) {
          const s1 = i * spacing, s2 = j * spacing;
          at(-E, s1, s2, a); at(E, s1, s2, b); seg(a, b); // lines along u
          at(s1, -E, s2, a); at(s1, E, s2, b); seg(a, b); // lines along v
          at(s1, s2, -E, a); at(s1, s2, E, b); seg(a, b); // lines along n
        }
      }
    } else {
      // ---- cylindrical: polar rings + spokes in the band plane (C7) ----
      for (const r of radii) circle(r, u, v);
      const rMax = radii[radii.length - 1];
      const SPOKES = 12;
      for (let s = 0; s < SPOKES; s++) {
        const t = (s / SPOKES) * Math.PI * 2;
        p(radii[0], t, a);
        p(rMax, t, b);
        seg(a, b);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = -40;
    this.group.add(lines);

    // Unit readouts: sprites along the +u axis at each radius (cylindrical/spherical)
    // or at each lattice spacing (cartesian).
    if (mode === 0) {
      const spacing = radii[1] ?? radii[0];
      const E = radii[radii.length - 1];
      for (let d = spacing; d <= E + 1e-9; d += spacing) {
        const sprite = ringLabelSprite(unit(d));
        sprite.position.copy(center).addScaledVector(u, d);
        sprite.scale.setScalar(Math.max(d * 0.14, 1e-9));
        this.group.add(sprite);
      }
    } else {
      for (const r of radii) {
        p(r, 0, a);
        const sprite = ringLabelSprite(unit(r));
        sprite.position.copy(a);
        sprite.scale.setScalar(Math.max(r * 0.14, 1e-9));
        this.group.add(sprite);
      }
    }
  }
}

function ringLabelSprite(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "600 44px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.shadowColor = "rgba(0,0,0,0.9)"; g.shadowBlur = 10;
  g.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.85,
  }));
  sp.renderOrder = 60;
  return sp;
}
