// Travel trails (D15): a fading camera-facing ribbon along the actual flight
// path whenever the user moves fast (warp jumps and fast thrust). Ribbon color
// maps log-speed cool → hot; each journey fades out over ~15 s; last 5 kept.
// Toggle: settings "trails" (default ON). World-space (scene-level), subtle.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "../controls/Navigation";
import { settings } from "../ui/Settings";

const MAX_SAMPLES = 400;
const MAX_RIBBONS = 5;
const FADE_S = 15;
const HALF_W = 0.012; // metres — thin ribbon
const SPEED_ON = 1.0; // m/s world speed to start/continue a journey
const COOL = new THREE.Color(0x2b6cff), HOT = new THREE.Color(0xff7a2a);

interface Ribbon {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
}

export class TravelTrails implements Updatable {
  group = new THREE.Group();
  private ribbons: Ribbon[] = [];
  private pts: THREE.Vector3[] = [];
  private spd: number[] = [];
  private quiet = 0;
  private app: App;
  private nav: Navigation;

  constructor(app: App, nav: Navigation) {
    this.app = app;
    this.nav = nav;
    this.group.name = "travel-trails";
  }

  update(dt: number, _t: number): void {
    // Age + fade finished journeys.
    for (const r of [...this.ribbons]) {
      r.age += dt;
      r.mat.opacity = Math.max(0, 0.55 * (1 - r.age / FADE_S));
      if (r.age >= FADE_S) {
        this.group.remove(r.mesh);
        r.mesh.geometry.dispose(); r.mat.dispose();
        this.ribbons.splice(this.ribbons.indexOf(r), 1);
      }
    }

    const speed = this.nav.worldSpeed;
    const active = settings.get("trails") && speed > SPEED_ON;
    if (active) {
      this.quiet = 0;
      const p = this.app.camera.getWorldPosition(new THREE.Vector3());
      const last = this.pts[this.pts.length - 1];
      if (!last || last.distanceToSquared(p) > 0.005 * 0.005) {
        if (this.pts.length < MAX_SAMPLES) {
          this.pts.push(p);
          this.spd.push(speed);
        }
      }
    } else if (this.pts.length > 0) {
      // Journey over once motion has been quiet for half a second.
      this.quiet += dt;
      if (this.quiet > 0.5) {
        this.finalize();
        this.quiet = 0;
      }
    }
  }

  private finalize(): void {
    if (this.pts.length >= 2) {
      const ribbon = this.buildRibbon(this.pts, this.spd);
      if (ribbon) {
        this.ribbons.push(ribbon);
        this.group.add(ribbon.mesh);
        while (this.ribbons.length > MAX_RIBBONS) {
          const old = this.ribbons.shift()!;
          this.group.remove(old.mesh);
          old.mesh.geometry.dispose(); old.mat.dispose();
        }
      }
    }
    this.pts = [];
    this.spd = [];
  }

  private buildRibbon(pts: THREE.Vector3[], spd: number[]): Ribbon | null {
    const n = pts.length;
    if (n < 2) return null;
    const peak = Math.max(...spd, 1e-6);
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    const cam = this.app.camera.getWorldPosition(new THREE.Vector3());
    const tangent = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      tangent.copy(pts[Math.min(i + 1, n - 1)]).sub(pts[Math.max(i - 1, 0)]);
      toCam.copy(cam).sub(p);
      side.crossVectors(tangent, toCam);
      if (side.lengthSq() < 1e-12) side.set(0, 1, 0);
      side.normalize().multiplyScalar(HALF_W);
      pos.set([p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
      pos.set([p.x + side.x, p.y + side.y, p.z + side.z], i * 6 + 3);
      // Log-speed color map cool → hot.
      const t = THREE.MathUtils.clamp(Math.log10(spd[i] + 1) / Math.log10(peak + 1), 0, 1);
      c.lerpColors(COOL, HOT, t);
      col.set([c.r, c.g, c.b], i * 6);
      col.set([c.r, c.g, c.b], i * 6 + 3);
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 55;
    mesh.frustumCulled = false;
    return { mesh, mat, age: 0 };
  }
}
