// Spaceship navigation: velocity/inertia/thrust/brake + FTL jump state machine.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Selectable } from "../scene/Selection";
import { PC_IN_KM } from "../util/astro";
import { WORLD_PER_AU } from "../scene/SolarSystem";
import { KM_PER_AU } from "../data/solarSystemData";

export type JumpState = "idle" | "charging" | "warping" | "arriving";

const _lerpU = new THREE.Vector3();

export class Navigation implements Updatable {
  private app: App;
  velocity = new THREE.Vector3(); // world units / second (universe frame)
  /** Current thrust acceleration (log-adjustable), world units / s². */
  accel = 0.02;
  /** Damping factor for the brake. */
  braking = false;
  thrustInput = new THREE.Vector3(); // desired accel dir (camera-local, normalized-ish)
  jumpState: JumpState = "idle";
  jumpCharge = 0; // 0..1
  private jumpTarget: Selectable | null = null;
  private jumpStart = new THREE.Vector3();
  private jumpEnd = new THREE.Vector3();
  private jumpT = 0;
  private jumpDuration = 2;
  private selection: { getWorldPosition(s: Selectable, out?: THREE.Vector3): THREE.Vector3 };
  onJumpProgress: ((state: JumpState, charge: number) => void) | null = null;
  onArrive: ((s: Selectable) => void) | null = null;
  warpIntensity = 0;
  /** Speed the HUD displays. */
  get speedUnits(): number { return this.velocity.length(); }

  constructor(app: App, selection: Navigation["selection"]) {
    this.app = app;
    this.selection = selection;
  }

  /** Convert world-units/s into km/s using the local frame scale (solar vs galactic). */
  get kmPerUnit(): number {
    const d = this.app.rig.position.length(); // distance from Sun (origin) in world units
    // Inside the solar system's visual bubble, interpret units via the AU scale.
    return d < 1.5 ? WORLD_PER_AU * KM_PER_AU : PC_IN_KM;
  }

  setAccelLog(steps: number) {
    // Exponential accel range 1e-6 … 1e3 units/s²
    this.accel = THREE.MathUtils.clamp(this.accel * Math.pow(2, steps), 1e-7, 1e3);
  }

  /** Begin charging a jump (hold). Call releaseJump() to cancel before auto-fire. */
  startCharge(target: Selectable) {
    if (this.jumpState !== "idle") return;
    this.jumpTarget = target;
    this.jumpState = "charging";
    this.jumpCharge = 0;
  }

  releaseJump() {
    if (this.jumpState === "charging") {
      this.jumpState = "idle";
      this.jumpCharge = 0;
      this.onJumpProgress?.("idle", 0);
    }
  }

  /** Instant charge (single-press jump, e.g. XR B button). */
  quickJump(target: Selectable) {
    if (this.jumpState !== "idle") return;
    this.jumpTarget = target;
    this.fire();
  }

  private fire() {
    if (!this.jumpTarget) return;
    const targetPos = this.selection.getWorldPosition(this.jumpTarget, new THREE.Vector3());
    const camPos = this.app.camera.getWorldPosition(new THREE.Vector3());
    const dist = targetPos.distanceTo(camPos);
    const arrival = Math.max(this.jumpTarget.radiusWorld * 6, 1e-4);
    // Work in universe-local coordinates so floating-origin recenters don't break the path.
    const uniCam = this.app.universe.worldToLocal(camPos.clone());
    const uniTarget = this.app.universe.worldToLocal(targetPos.clone());
    const uniDir = uniTarget.clone().sub(uniCam).normalize();
    this.jumpStart.copy(uniCam);
    this.jumpEnd.copy(uniTarget).addScaledVector(uniDir, -arrival);
    this.jumpT = 0;
    this.jumpDuration = THREE.MathUtils.clamp(1.2 + Math.log10(Math.max(dist, 1e-6)) * 0.55, 1.2, 4.5);
    this.jumpState = "warping";
    this.velocity.set(0, 0, 0);
    this.warpIntensity = 1;
  }

  update(dt: number, _t: number) {
    const rig = this.app.rig;
    if (this.jumpState === "charging") {
      this.jumpCharge = Math.min(1, this.jumpCharge + dt / 1.1); // ~1.1 s charge
      this.warpIntensity = this.jumpCharge * 0.4;
      this.onJumpProgress?.("charging", this.jumpCharge);
      if (this.jumpCharge >= 1) this.fire();
      return;
    }
    if (this.jumpState === "warping") {
      this.jumpT += dt / this.jumpDuration;
      const k = THREE.MathUtils.clamp(this.jumpT, 0, 1);
      // Smoothstep with a long "lightspeed plateau".
      const e = k * k * (3 - 2 * k);
      // Universe-local lerp, then convert back to rig frame (floating-origin safe).
      _lerpU.lerpVectors(this.jumpStart, this.jumpEnd, e).sub(this.app.universe.position);
      rig.position.copy(_lerpU);
      this.warpIntensity = Math.sin(Math.min(k * 1.15, 1) * Math.PI) * 1.0 + 0.05;
      // Face travel direction gradually.
      if (k >= 1) {
        this.jumpState = "arriving";
        this.warpIntensity = 0;
        this.onJumpProgress?.("arriving", 1);
        if (this.jumpTarget) this.onArrive?.(this.jumpTarget);
        this.jumpState = "idle";
        this.jumpCharge = 0;
        this.onJumpProgress?.("idle", 0);
      }
      return;
    }
    // --- normal flight ---
    const accel = this.accel;
    if (this.thrustInput.lengthSq() > 0) {
      // Camera-oriented thrust.
      const q = this.app.camera.getWorldQuaternion(new THREE.Quaternion());
      const a = this.thrustInput.clone().applyQuaternion(q).multiplyScalar(accel);
      this.velocity.addScaledVector(a, dt);
    }
    if (this.braking) {
      const v = this.velocity.length();
      if (v > 0) {
        const dec = Math.max(v * 2.5, accel * 0.5);
        this.velocity.setLength(Math.max(0, v - dec * dt));
      }
    }
    // Tiny ambient damping so speeds don't grow without bound.
    this.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.02));
    rig.position.addScaledVector(this.velocity, dt);
  }
}
