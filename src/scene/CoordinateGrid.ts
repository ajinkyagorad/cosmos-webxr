// Cylindrical coordinate grid (C7): polar rings + spokes, auto-switched by zoom band.
//   log > 0.5   → solar-system grid: rings in AU in the ECLIPTIC plane, centered on the Sun
//   −3 … 0.5    → local-stellar grid: rings in light-years, galactic plane, centered on the Sun
//   ≤ −3        → galactic grid: rings in kpc, galactic plane, centered on the real GC
// All geometry lives in the universe group so it scales/rotates with everything else.
// Toggle: settings "layerGrid" (default OFF).
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

  constructor() {
    this.group.name = "coordinate-grid";
    this.group.visible = false;
  }

  /** Called every frame; rebuilds only when the band or orbit exaggeration changes. */
  update(logScale: number, orbitExaggeration: number): void {
    const band: Band = logScale > 0.5 ? "solar" : logScale <= -3 ? "galactic" : "stellar";
    if (band === this.band && (band !== "solar" || orbitExaggeration === this.builtExagg)) return;
    this.band = band;
    this.builtExagg = orbitExaggeration;
    this.rebuild(orbitExaggeration);
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

  private rebuild(orbitExaggeration: number): void {
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
      const ly = [4, 8, 16, 32, 64];
      center = new THREE.Vector3(); // the Sun is the universe-local origin
      normal = GALACTIC_NORMAL_V;
      radii = ly.map((l) => l / 3.26156);
      unit = (r) => `${(r * 3.26156).toFixed(0)} ly`;
    } else {
      const kpc = [1, 2, 4, 8, 16, 32];
      center = GALACTIC_CENTER_PC.clone();
      normal = GALACTIC_NORMAL_V;
      radii = kpc.map((k) => k * 1000);
      unit = (r) => `${(r / 1000).toFixed(0)} kpc`;
    }
    // In-plane basis
    const n = normal.clone().normalize();
    const u = Math.abs(n.y) < 0.9
      ? new THREE.Vector3(0, 1, 0).cross(n).normalize()
      : new THREE.Vector3(1, 0, 0).cross(n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    const SEG = 72, SPOKES = 12;
    const verts: number[] = [];
    const p = (r: number, t: number, out: THREE.Vector3) =>
      out.copy(center).addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const r of radii) {
      for (let s = 0; s < SEG; s++) {
        p(r, (s / SEG) * Math.PI * 2, a);
        p(r, ((s + 1) / SEG) * Math.PI * 2, b);
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const rMax = radii[radii.length - 1];
    for (let s = 0; s < SPOKES; s++) {
      const t = (s / SPOKES) * Math.PI * 2;
      p(radii[0], t, a);
      p(rMax, t, b);
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = -40;
    this.group.add(lines);

    // Ring unit readouts: small sprites at each ring's +u point.
    for (const r of radii) {
      p(r, 0, a);
      const sprite = ringLabelSprite(unit(r));
      sprite.position.copy(a);
      sprite.scale.setScalar(Math.max(r * 0.14, 1e-9));
      this.group.add(sprite);
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
