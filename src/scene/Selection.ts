// Target selection: registry of selectable objects + angular ray picking + target marker.
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
  /** HTML description for the info panel. */
  describe: () => string;
}

const _v = new THREE.Vector3();
const _toObj = new THREE.Vector3();

export class Selection implements Updatable {
  private app: App;
  private items: Selectable[] = [];
  target: Selectable | null = null;
  marker: THREE.Mesh;
  onTargetChanged: ((s: Selectable | null) => void) | null = null;
  /** Max registry size is small enough (~1000) for on-demand angular scans. */

  constructor(app: App) {
    this.app = app;
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7db4ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
    this.marker = new THREE.Mesh(geo, mat);
    this.marker.visible = false;
    this.marker.renderOrder = 50;
    this.app.scene.add(this.marker); // scene-level: we position it in world coords every frame
  }

  registerMany(items: Selectable[]) {
    this.items.push(...items);
  }

  getWorldPosition(s: Selectable, out = new THREE.Vector3()): THREE.Vector3 {
    if (s.object) return s.object.getWorldPosition(out);
    if (s.position) return out.copy(s.position).applyMatrix4(this.app.universe.matrixWorld);
    return out.set(0, 0, 0);
  }

  select(s: Selectable | null) {
    this.target = s;
    this.marker.visible = !!s;
    this.onTargetChanged?.(s);
  }

  clear() { this.select(null); }

  /** Angular pick: find the registry object nearest to the ray within a tolerant cone. */
  pickFromRay(raycaster: THREE.Raycaster): Selectable | null {
    const origin = raycaster.ray.origin;
    const dir = raycaster.ray.direction;
    let best: Selectable | null = null;
    let bestScore = Infinity;
    for (const s of this.items) {
      this.getWorldPosition(s, _v);
      _toObj.subVectors(_v, origin);
      const dist = _toObj.length();
      if (dist < 1e-9) continue;
      const cosA = THREE.MathUtils.clamp(_toObj.dot(dir) / dist, -1, 1);
      if (cosA < 0.5) continue; // behind or far off-axis
      const angle = Math.acos(cosA);
      // Tolerance: at least 0.5°, up to 4°, scaled by object radius.
      const tol = THREE.MathUtils.clamp(Math.atan((s.radiusWorld * 4) / dist), THREE.MathUtils.degToRad(0.5), THREE.MathUtils.degToRad(4));
      if (angle < tol && angle < bestScore) {
        bestScore = angle;
        best = s;
      }
    }
    return best;
  }

  update(dt: number, t: number) {
    if (!this.target) return;
    this.getWorldPosition(this.target, _v);
    this.marker.position.copy(_v);
    // Face camera & scale with distance so the ring stays readable.
    this.marker.quaternion.copy(this.app.camera.getWorldQuaternion(new THREE.Quaternion()));
    const camPos = this.app.camera.getWorldPosition(_toObj);
    const d = _v.distanceTo(camPos);
    const s = Math.max(this.target.radiusWorld * 1.6, d * 0.02);
    this.marker.scale.setScalar(s);
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(t * 3);
  }
}
