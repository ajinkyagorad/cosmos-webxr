// Travel trails (D15, reworked #47): a FINE 1-px line tracing the ship's actual
// path — sampled ONLY during go-to warp journeys (jumpState === "warping"), never
// from free head movement / thrust / grab. Color maps log-speed cool → hot along
// the path; each finished journey fades out over ~15 s; last 5 kept.
// Toggle: settings "trails" (default ON). World-space (scene-level), subtle.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "../controls/Navigation";
import { settings } from "../ui/Settings";

const MAX_SAMPLES = 600;
const MAX_TRAILS = 5;
const FADE_S = 15;
const COOL = new THREE.Color(0x2b6cff), HOT = new THREE.Color(0xff7a2a);

interface Trail {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  age: number;
}

export class TravelTrails implements Updatable {
  group = new THREE.Group();
  private trails: Trail[] = [];
  private pts: THREE.Vector3[] = [];
  private spd: number[] = [];
  private wasWarping = false;
  private app: App;
  private nav: Navigation;

  constructor(app: App, nav: Navigation) {
    this.app = app;
    this.nav = nav;
    this.group.name = "travel-trails";
  }

  update(dt: number, _t: number): void {
    // Age + fade finished journeys.
    for (const r of [...this.trails]) {
      r.age += dt;
      r.mat.opacity = Math.max(0, 0.7 * (1 - r.age / FADE_S));
      if (r.age >= FADE_S) {
        this.group.remove(r.line);
        r.line.geometry.dispose(); r.mat.dispose();
        this.trails.splice(this.trails.indexOf(r), 1);
      }
    }

    // #47: sample the camera path ONLY while a go-to jump is warping.
    const warping = settings.get("trails") && this.nav.jumpState === "warping";
    if (warping) {
      this.wasWarping = true;
      const p = this.app.camera.getWorldPosition(new THREE.Vector3());
      const last = this.pts[this.pts.length - 1];
      if (!last || last.distanceToSquared(p) > 0.002 * 0.002) {
        if (this.pts.length < MAX_SAMPLES) {
          this.pts.push(p);
          this.spd.push(this.nav.worldSpeed);
        }
      }
    } else if (this.wasWarping) {
      // Jump ended (arrived or cancelled) → freeze the path into a fading trail.
      this.wasWarping = false;
      this.finalize();
    }
  }

  private finalize(): void {
    if (this.pts.length >= 2) {
      const trail = this.buildLine(this.pts, this.spd);
      if (trail) {
        this.trails.push(trail);
        this.group.add(trail.line);
        while (this.trails.length > MAX_TRAILS) {
          const old = this.trails.shift()!;
          this.group.remove(old.line);
          old.line.geometry.dispose(); old.mat.dispose();
        }
      }
    }
    this.pts = [];
    this.spd = [];
  }

  private buildLine(pts: THREE.Vector3[], spd: number[]): Trail | null {
    const n = pts.length;
    if (n < 2) return null;
    const peak = Math.max(...spd, 1e-6);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set([pts[i].x, pts[i].y, pts[i].z], i * 3);
      // Log-speed color map cool → hot along the path.
      const t = THREE.MathUtils.clamp(Math.log10(spd[i] + 1) / Math.log10(peak + 1), 0, 1);
      c.lerpColors(COOL, HOT, t);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.7,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 55;
    line.frustumCulled = false;
    return { line, mat, age: 0 };
  }
}
