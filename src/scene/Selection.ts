// Target selection: registry of selectable objects + angular ray picking + 3D crosshair marker.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";

export interface Selectable {
  id: string;
  name: string;
  kind: string;
  /** Static universe-local position (for catalog objects) OR moving object3D (planets/missions). */
  position?: THREE.Vector3;
  object?: THREE.Object3D;
  /** World-space radius used for arrival distance + angular pick tolerance. */
  radiusWorld: number;
  /** Solid bodies (planets/sun/moon): used for collision floor + gentle-approach speed caps. */
  solid?: boolean;
  /** HTML description for the info panel. */
  describe: () => string;
}

const _v = new THREE.Vector3();
const _toObj = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * 3D crosshair targeting marker (Elite-style): a cube frame of 8 corner brackets with
 * inward-pointing edges, gently pulsing, screen-size compensated.
 */
class CrosshairMarker {
  group = new THREE.Group();
  private mat: THREE.LineBasicMaterial;

  constructor() {
    this.mat = new THREE.LineBasicMaterial({
      color: 0x8fc4ff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    });
    // 8 corners of a unit cube; each corner has 3 short inward-pointing edges.
    const verts: number[] = [];
    const L = 0.22; // bracket arm length (fraction of half-size)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      verts.push(
        sx, sy, sz, sx - Math.sign(sx) * L, sy, sz, // x arm
        sx, sy, sz, sx, sy - Math.sign(sy) * L, sz, // y arm
        sx, sy, sz, sx, sy, sz - Math.sign(sz) * L, // z arm
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    const lines = new THREE.LineSegments(geo, this.mat);
    lines.renderOrder = 60;
    lines.frustumCulled = false;
    this.group.add(lines);
    this.group.visible = false;
  }

  /** Position/scale/rotate the marker around `center`, facing `camQuat`, at distance `dist`. */
  place(center: THREE.Vector3, camQuat: THREE.Quaternion, dist: number, radiusWorld: number, t: number) {
    this.group.position.copy(center);
    this.group.quaternion.copy(camQuat);
    // Half-size: at least 2.2× object radius, at least ~3% of view distance, pulsing gently.
    const pulse = 1 + 0.06 * Math.sin(t * 2.6);
    const half = Math.max(radiusWorld * 2.2, dist * 0.03) * pulse;
    this.group.scale.setScalar(half);
    this.mat.opacity = 0.55 + 0.3 * Math.sin(t * 3.2);
  }

  set visible(v: boolean) { this.group.visible = v; }
  get visible() { return this.group.visible; }
}

export class Selection implements Updatable {
  private app: App;
  private items: Selectable[] = [];
  target: Selectable | null = null;
  marker = new CrosshairMarker();
  onTargetChanged: ((s: Selectable | null) => void) | null = null;

  constructor(app: App) {
    this.app = app;
    this.app.scene.add(this.marker.group); // scene-level: positioned in world coords each frame
  }

  registerMany(items: Selectable[]) {
    this.items.push(...items);
  }

  getWorldPosition(s: Selectable, out = new THREE.Vector3()): THREE.Vector3 {
    if (s.object) return s.object.getWorldPosition(out);
    if (s.position) return out.copy(s.position).applyMatrix4(this.app.universe.matrixWorld);
    return out.set(0, 0, 0);
  }

  /** Universe-local (parsec) position of any selectable. */
  getUniPosition(s: Selectable, out = new THREE.Vector3()): THREE.Vector3 {
    if (s.object) {
      s.object.getWorldPosition(out);
      return this.app.universe.worldToLocal(out);
    }
    if (s.position) return out.copy(s.position);
    return out.set(0, 0, 0);
  }

  /** Live world-space radius (metres) of a selectable. Object selectables (planets,
   *  probes, sprites) carry their size in their scale; catalog selectables store
   *  radiusWorld in universe-local pc, converted by the universe scale. */
  worldRadius(s: Selectable): number {
    if (s.object) return Math.max(s.object.getWorldScale(_v).x, 1e-12);
    return s.radiusWorld * this.app.universe.scale.x;
  }

  select(s: Selectable | null) {
    this.target = s;
    this.marker.visible = !!s;
    this.onTargetChanged?.(s);
  }

  clear() { this.select(null); }

  /**
   * Angular pick with magnetism: find the registry object nearest to the ray within a
   * tolerant cone. The ray (world space) is transformed into universe-local space so
   * distances and radii share one unit (pc) regardless of the current log scale.
   * tolScale widens the cone (used for imprecise hand aim).
   */
  private _localRay = new THREE.Ray();
  pickFromRay(raycaster: THREE.Raycaster, tolScale = 1): Selectable | null {
    this._localRay.copy(raycaster.ray).applyMatrix4(
      _m.copy(this.app.universe.matrixWorld).invert(),
    );
    this._localRay.direction.normalize();
    const origin = this._localRay.origin;
    const dir = this._localRay.direction;
    let best: Selectable | null = null;
    let bestScore = Infinity;
    for (const s of this.items) {
      this.getUniPosition(s, _v);
      _toObj.subVectors(_v, origin);
      const dist = _toObj.length();
      if (dist < 1e-9) continue;
      const cosA = THREE.MathUtils.clamp(_toObj.dot(dir) / dist, -1, 1);
      if (cosA < 0.4) continue; // behind or far off-axis
      const angle = Math.acos(cosA);
      // Tolerance: at least 0.5°, up to 4.5°, scaled by object radius (ray magnetism).
      const tol = THREE.MathUtils.clamp(
        Math.atan((s.radiusWorld * 4) / dist),
        THREE.MathUtils.degToRad(0.5),
        THREE.MathUtils.degToRad(4.5),
      ) * tolScale;
      if (angle < tol && angle < bestScore) {
        bestScore = angle;
        best = s;
      }
    }
    return best;
  }

  /**
   * Nearest SOLID body to a universe-local point: { surfaceDist, radius } (pc units).
   * Kept for diagnostics/tests; the atlas model has no collision physics.
   */
  nearestSolid(uniPos: THREE.Vector3): { surfaceDist: number; radius: number } {
    let best = Infinity;
    let bestR = 0.001;
    for (const s of this.items) {
      if (!s.solid) continue;
      this.getUniPosition(s, _v);
      const d = _v.distanceTo(uniPos) - s.radiusWorld;
      if (d < best) { best = d; bestR = s.radiusWorld; }
    }
    return { surfaceDist: Math.max(best, 0), radius: bestR };
  }

  update(_dt: number, t: number) {
    if (!this.target) return;
    this.getWorldPosition(this.target, _v);
    const camPos = this.app.camera.getWorldPosition(_toObj);
    const d = _v.distanceTo(camPos);
    this.marker.place(_v, this.app.camera.getWorldQuaternion(new THREE.Quaternion()), d, this.worldRadius(this.target), t);
  }
}
