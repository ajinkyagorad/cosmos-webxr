// Spaceship navigation: inertia/thrust/brake + REAL-travel FTL jumps (the ship genuinely
// accelerates through the actual star field — no fake warp animation), proximity-aware
// speed caps, collision floor, breadcrumbs and Return Home so the user can never get lost.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Selectable } from "../scene/Selection";
import { PC_IN_KM } from "../util/astro";
import { WORLD_PER_AU } from "../scene/SolarSystem";
import { KM_PER_AU } from "../data/solarSystemData";

export type JumpState = "idle" | "charging" | "warping";

/** Hard absolute speed cap (world units/s). Prevents runaway zoom into the void. */
const HARD_CAP = 2e4;
/** Home base: just outside Earth's orbit, universe-local. */
export const HOME_POS = new THREE.Vector3(0, 0.02, 0.09);

interface SelectionLike {
  getWorldPosition(s: Selectable, out?: THREE.Vector3): THREE.Vector3;
  nearestSolid(uniPos: THREE.Vector3): { surfaceDist: number; radius: number };
}

const _uni = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Navigation implements Updatable {
  private app: App;
  velocity = new THREE.Vector3(); // world axes, units/s
  accel = 0.02;                   // user thrust power (log adjustable), units/s²
  braking = false;
  thrustInput = new THREE.Vector3();
  jumpState: JumpState = "idle";
  jumpCharge = 0;

  private selection: SelectionLike;
  private jumpTarget: Selectable | null = null;
  private jumpTargetPos: THREE.Vector3 | null = null; // for breadcrumb jumps (no Selectable)
  private jumpRadius = 0.1;
  private jumpD = 0;
  private jumpElapsed = 0;
  private jumpDuration = 2;
  private breadcrumbs: THREE.Vector3[] = [];
  private lastBreadcrumbPos = new THREE.Vector3();

  onJumpProgress: ((state: JumpState, charge: number) => void) | null = null;
  onArrive: ((s: Selectable | null) => void) | null = null;
  /** Called during the final warp phase so the ship rotates to face the destination. */
  onOrient: ((dirWorld: THREE.Vector3, alpha: number) => void) | null = null;

  get speedUnits(): number { return this.velocity.length(); }

  /** Peak speed of the current jump profile (for FOV/audio intensity normalization). */
  get jumpPeakSpeed(): number {
    return this.jumpState === "warping" ? (this.jumpD / this.jumpDuration) * 1.5 : 0;
  }

  constructor(app: App, selection: SelectionLike) {
    this.app = app;
    this.selection = selection;
    this.lastBreadcrumbPos.copy(HOME_POS);
  }

  /** km per world unit in the local frame (AU-scale near the Sun, pc-scale outside). */
  get kmPerUnit(): number {
    const d = this.app.rig.position.length();
    return d < 1.5 ? WORLD_PER_AU * KM_PER_AU : PC_IN_KM;
  }

  /** Current universe-local rig position (floating-origin safe). */
  universePos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.app.rig.position).add(this.app.universe.position);
  }

  setAccelLog(steps: number) {
    this.accel = THREE.MathUtils.clamp(this.accel * Math.pow(2, steps), 1e-7, 1e3);
  }

  /** Record a breadcrumb (universe-local) if we've actually moved somewhere new. */
  private dropBreadcrumb() {
    const p = this.universePos(new THREE.Vector3());
    if (p.distanceTo(this.lastBreadcrumbPos) > 0.5) {
      this.breadcrumbs.push(p);
      if (this.breadcrumbs.length > 20) this.breadcrumbs.shift();
      this.lastBreadcrumbPos.copy(p);
    }
  }

  /** Warp back to the previous breadcrumb. Returns false if no breadcrumbs. */
  goBack(): boolean {
    const crumb = this.breadcrumbs.pop();
    if (!crumb) return false;
    this.jumpTarget = null;
    this.jumpTargetPos = crumb.clone();
    this.jumpRadius = 0.05;
    this.fireInternal();
    return true;
  }

  /** Warp home to the solar system. */
  goHome() {
    this.dropBreadcrumb();
    this.jumpTarget = null;
    this.jumpTargetPos = HOME_POS.clone();
    this.jumpRadius = 0.02;
    this.fireInternal();
  }

  get hasBreadcrumbs(): boolean { return this.breadcrumbs.length > 0; }

  startCharge(target: Selectable) {
    if (this.jumpState !== "idle") return;
    this.jumpTarget = target;
    this.jumpTargetPos = null;
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

  quickJump(target: Selectable) {
    if (this.jumpState !== "idle") return;
    this.jumpTarget = target;
    this.jumpTargetPos = null;
    this.fireInternal();
  }

  private fireInternal() {
    this.dropBreadcrumb();
    const tp = this.liveTargetUni(new THREE.Vector3());
    if (!tp) { this.jumpState = "idle"; return; }
    const here = this.universePos(_uni);
    const D = here.distanceTo(tp);
    if (D < 1e-9) { this.jumpState = "idle"; return; }
    this.jumpD = D;
    // Journey time grows with log distance; big jumps feel like a journey (3–9 s).
    this.jumpDuration = THREE.MathUtils.clamp(1.4 + Math.log10(Math.max(D, 1e-6)) * 0.8, 1.4, 9);
    this.jumpElapsed = 0;
    this.jumpState = "warping";
    this.velocity.set(0, 0, 0);
    this.onJumpProgress?.("warping", 0);
  }

  /** Live (current-frame) universe-local target position — tracks moving planets. */
  private liveTargetUni(out: THREE.Vector3): THREE.Vector3 | null {
    if (this.jumpTarget) {
      this.selection.getWorldPosition(this.jumpTarget, out);
      out.sub(this.app.universe.position); // world → universe-local
      return out;
    }
    if (this.jumpTargetPos) return out.copy(this.jumpTargetPos);
    return null;
  }

  private arrivalDistance(): number {
    if (this.jumpTarget) return Math.max(this.jumpTarget.radiusWorld * 4.5, 1e-5);
    return this.jumpRadius;
  }

  update(dt: number, _t: number) {
    const rig = this.app.rig;
    if (this.jumpState === "charging") {
      this.jumpCharge = Math.min(1, this.jumpCharge + dt / 1.1);
      this.onJumpProgress?.("charging", this.jumpCharge);
      if (this.jumpCharge >= 1) this.fireInternal();
      return;
    }
    if (this.jumpState === "warping") {
      this.jumpElapsed += dt;
      const k = THREE.MathUtils.clamp(this.jumpElapsed / this.jumpDuration, 0, 1);
      const tp = this.liveTargetUni(_tv);
      if (!tp) { this.jumpState = "idle"; return; }
      const here = this.universePos(_uni);
      _dir.subVectors(tp, here);
      const distNow = _dir.length();
      const arrival = this.arrivalDistance();
      const remaining = distNow - arrival;
      if (remaining <= 0 || k >= 1) {
        // Arrived: settle, face target, notify.
        this.velocity.multiplyScalar(0.02);
        this.jumpState = "idle";
        this.jumpCharge = 0;
        this.onJumpProgress?.("idle", 0);
        this.onOrient?.(_dir.normalize(), 1); // final snap to face destination
        this.onArrive?.(this.jumpTarget);
        return;
      }
      _dir.normalize();
      // Smoothstep speed profile: speed = (D/T)·6k(1−k) — genuinely integrates position
      // through the real star field. HUD/audio/vignette all follow this real velocity.
      const speed = (this.jumpD / this.jumpDuration) * 6 * k * (1 - k);
      // Never overshoot the remaining distance this frame.
      const step = Math.min(speed * dt, remaining);
      rig.position.addScaledVector(_dir, step);
      this.velocity.copy(_dir).multiplyScalar(step / Math.max(dt, 1e-6));
      // Final approach: orient the ship toward the destination.
      if (k > 0.55) {
        const alpha = THREE.MathUtils.clamp((k - 0.55) / 0.45, 0, 1) * Math.min(1, dt * 3);
        this.onOrient?.(_dir, alpha);
      }
      return;
    }

    // ---------------- normal flight ----------------
    if (this.thrustInput.lengthSq() > 0) {
      const q = this.app.camera.getWorldQuaternion(new THREE.Quaternion());
      const a = this.thrustInput.clone().applyQuaternion(q).multiplyScalar(this.accel);
      this.velocity.addScaledVector(a, dt);
    }
    if (this.braking) {
      const v = this.velocity.length();
      if (v > 0) {
        const dec = Math.max(v * 2.5, this.accel * 0.5);
        this.velocity.setLength(Math.max(0, v - dec * dt));
      }
    }
    this.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.02));

    // Proximity-aware speed cap: gentle near solid bodies, hard-capped everywhere.
    const near = this.selection.nearestSolid(this.universePos(_uni));
    const approachCap = Math.max(near.surfaceDist * 0.6, near.radius * 0.05, 1e-6);
    const vmax = Math.min(HARD_CAP, approachCap);
    const sp = this.velocity.length();
    if (sp > vmax) this.velocity.setLength(vmax);

    // Collision floor: never pass through ~1.05× radius of a solid body.
    const floor = near.radius * 1.05;
    if (near.surfaceDist < floor) {
      // Cancel any velocity component that takes us deeper.
      const sp2 = this.velocity.length();
      if (sp2 > 0) {
        // Direction to body ≈ -direction of increasing surfaceDist; use radial estimate:
        // recompute body direction via finite difference of nearestSolid (cheap, solids few).
        const probe = _tv.copy(_uni).addScaledVector(this.velocity, dt / Math.max(sp2, 1e-9));
        const next = this.selection.nearestSolid(probe);
        if (next.surfaceDist < near.surfaceDist) this.velocity.setLength(0);
      }
    }

    rig.position.addScaledVector(this.velocity, dt);
  }
}
