// Atlas navigation model (mirrors the Milky Way Atlas reference app):
// the USER stays at the origin; the universe group moves, rotates and log-scales
// around them. All inputs steer TARGETS (tgtPos / tgtQuat / targetLog) and the
// universe eases toward them with damped exponential smoothing k = 1 − e^(−6.5·dt) —
// deliberate, drift-free motion: release a control and the universe settles exactly
// onto the current target, always.
//
//   · left stick / WASD ........ translate the universe opposite the gaze (fly)
//   · right stick X ............ yaw the universe about the user's head
//   · right stick Y / scroll ... log-scale zoom, hard-clamped [LOG_MIN, LOG_MAX]
//   · grip / pinch ............. 1:1 grab of the universe
//   · two grips / pinches ...... pinch-scale + yaw about the hand midpoint
//   · travel (jump/home/back) .. eased accelerate→cruise→decelerate of the universe
//                                transform, orienting first, arriving facing the target
//
// universe-local coordinates are parsecs (equatorial J2000); universe.scale is
// metres per parsec = 10^logScale. Because the user never leaves the origin there
// is no floating origin and no velocity state at all.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Selectable } from "../scene/Selection";
import { PC_IN_KM } from "../util/astro";
import { WORLD_PER_AU } from "../scene/SolarSystem";

export type JumpState = "idle" | "charging" | "warping";

/** Log-scale clamps: universe.scale = 10^logScale metres per parsec. */
export const LOG_MIN = -7.3;  // whole Local Group fits in the room
export const LOG_MAX = 2.6;   // solar-system museum model fills the room
/** Home: hovering just off Earth in the museum solar system. */
export const HOME_LOG = 2.1;
export const HOME_UNI = new THREE.Vector3(0.03, 0.004, 0.01); // pc — just outside Earth's orbit

/** A travel destination: universe-local position + target log scale + label. */
export interface Destination { p: THREE.Vector3; log: number; label: string; sel?: Selectable | null; }
interface PoseSnapshot { p: THREE.Vector3; q: THREE.Quaternion; l: number; label: string; }
interface Travel {
  t: number; dur: number;
  p0: THREE.Vector3; q0: THREE.Quaternion; l0: number;
  p1: THREE.Vector3; q1: THREE.Quaternion; l1: number;
  sel: Selectable | null; label: string;
}
type PoseGetter = () => THREE.Matrix4 | null;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function smoothstep5(x: number): number {
  x = THREE.MathUtils.clamp(x, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export class Navigation implements Updatable {
  private app: App;

  // ---- target state (what the controls steer) ----
  readonly tgtPos = new THREE.Vector3();
  readonly tgtQuat = new THREE.Quaternion();
  targetLog = HOME_LOG;
  /** Current eased log scale (universe.scale.x = 10^logScale). */
  logScale = HOME_LOG;

  // ---- jump/travel state ----
  jumpState: JumpState = "idle";
  jumpCharge = 0;
  private travel: Travel | null = null;
  private chargeTarget: Selectable | null = null;
  private breadcrumbs: PoseSnapshot[] = [];

  // ---- grab state (mirrors reference updateGrab) ----
  private grabActive: [boolean, boolean] = [false, false];
  private grabGetter: [PoseGetter | null, PoseGetter | null] = [null, null];
  private g0 = [new THREE.Matrix4(), new THREE.Matrix4()];
  private m0 = new THREE.Matrix4();
  private d0 = 1;
  private s0 = 1;
  private mid0 = new THREE.Vector3();
  private p0 = new THREE.Vector3();
  private q0 = new THREE.Quaternion();
  private dir0 = new THREE.Vector3(1, 0, 0);

  // ---- speed bookkeeping (actual eased motion — drives HUD/audio/vignette) ----
  private prevUserUni = new THREE.Vector3();
  private speedSmooth = 0;        // pc/s
  private worldSpeedSmooth = 0;   // m/s
  private peakWorldSpeed = 0;     // running max during travel

  /** Desktop WASD sets this camera-space input each frame (−1..1 xyz). */
  readonly thrustInput = new THREE.Vector3();
  thrustBoost = 1;

  onJumpProgress: ((state: JumpState, charge: number) => void) | null = null;
  onArrive: ((s: Selectable | null) => void) | null = null;
  /** grab/pinch start+end hooks (haptics). */
  onGrabStart: ((twoHanded: boolean) => void) | null = null;
  onGrabEnd: (() => void) | null = null;
  /** fired when targetLog changes via pinch/stick/scroll (UI readouts). */
  onZoom: (() => void) | null = null;

  constructor(app: App) {
    this.app = app;
    this.setPoseImmediate(HOME_UNI, new THREE.Quaternion(), HOME_LOG);
  }

  /* ---------------- pose helpers ---------------- */

  get scale(): number { return Math.pow(10, this.logScale); }
  get targetScale(): number { return Math.pow(10, this.targetLog); }

  /** km per universe-local unit: always parsecs now. */
  get kmPerUnit(): number { return PC_IN_KM; }

  /** Head world position (desktop: camera; XR: headset). */
  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.app.camera.getWorldPosition(out);
  }

  /** The user's current universe-local position (parsec frame). */
  universePos(out = new THREE.Vector3()): THREE.Vector3 {
    this.headWorld(out);
    return this.app.universe.worldToLocal(out);
  }

  /** Current speed in pc/s (eased, actual motion of the universe past the user). */
  get speedUnits(): number { return this.speedSmooth; }
  /** Current speed in world metres/s. */
  get worldSpeed(): number { return this.worldSpeedSmooth; }
  /** Peak world speed of the current travel (FOV/audio normalization). */
  get jumpPeakSpeed(): number {
    return this.jumpState === "warping" ? Math.max(this.peakWorldSpeed, this.worldSpeedSmooth) : 0;
  }

  get isTraveling(): boolean { return this.travel !== null; }
  get hasBreadcrumbs(): boolean { return this.breadcrumbs.length > 0; }

  /** Instantly set the universe pose so universe-local `uniPos` sits at the head. */
  setPoseImmediate(uniPos: THREE.Vector3, quat: THREE.Quaternion, log: number) {
    this.logScale = this.targetLog = log;
    const s = this.targetScale;
    this.tgtQuat.copy(quat);
    this.tgtPos.copy(uniPos).applyQuaternion(quat).multiplyScalar(-s);
    const u = this.app.universe;
    u.position.copy(this.tgtPos);
    u.quaternion.copy(quat);
    u.scale.setScalar(s);
    u.updateMatrixWorld(true);
    this.universePos(this.prevUserUni);
  }

  /* ---------------- input: fly / yaw / zoom ---------------- */

  /** Fly speed in world m/s — reference formula, with an AU-scale bracket near home. */
  flySpeed(): number {
    const s = this.scale;
    const base = 1.6 * Math.max(s * 300, 0.25);
    const uniLen = this.prevUserUni.length();
    if (uniLen < 2.0) {
      // Museum solar system: content is AU-scale (1 AU = WORLD_PER_AU units), so the
      // parsec-proportional formula would be absurdly fast. Blend to an AU bracket.
      const solar = 1.6 * Math.max(s * WORLD_PER_AU * 0.6, 0.25);
      const f = THREE.MathUtils.smoothstep(uniLen, 0.5, 2.0);
      return solar + (base - solar) * f;
    }
    return base;
  }

  /** Left stick (XR): head-relative fly. Raw gamepad axes (push-up = −y). */
  flyStick(x: number, y: number, dt: number) {
    if (Math.abs(x) < 0.12 && Math.abs(y) < 0.12) return;
    const cam = this.app.camera;
    cam.getWorldDirection(_v1);           // gaze
    _v2.crossVectors(_v1, UP).normalize(); // right
    const speed = this.flySpeed() * dt;
    // pushing forward moves the USER forward ⇔ the universe backward along the gaze
    this.tgtPos.addScaledVector(_v1, y * speed);
    this.tgtPos.addScaledVector(_v2, -x * speed);
  }

  /** Desktop WASD: thrustInput is the user's velocity intent in camera space
   *  (x right, y up, z forward), so the universe is translated the opposite way. */
  private flyThrust(dt: number) {
    if (this.thrustInput.lengthSq() < 0.001) return;
    const q = this.app.camera.getWorldQuaternion(_q1);
    // camera looks down its −z axis, so forward intent (z=+1) maps to −z first
    _v1.set(this.thrustInput.x, this.thrustInput.y, -this.thrustInput.z).applyQuaternion(q);
    this.tgtPos.addScaledVector(_v1, -this.flySpeed() * this.thrustBoost * dt);
  }

  /** Yaw the universe about the user's head (turn-in-place; no translation of the user). */
  yawAboutHead(angle: number) {
    const head = this.headWorld(_v3);
    _q1.setFromAxisAngle(UP, angle);
    this.tgtPos.sub(head).applyQuaternion(_q1).add(head);
    this.tgtQuat.premultiply(_q1);
  }

  /** Right stick X (smooth turn). */
  yawStick(x: number, dt: number, degPerSec: number) {
    if (Math.abs(x) < 0.15) return;
    this.yawAboutHead(-x * dt * THREE.MathUtils.degToRad(degPerSec));
  }

  /** Log-scale zoom, hard-clamped. Right stick Y (raw axis; push-up zooms in). */
  zoomStick(y: number, dt: number) {
    if (Math.abs(y) <= 0.15) return;
    this.setTargetLog(this.targetLog - Math.sign(y) * dt * 0.55);
  }

  /** Scroll-wheel / button zoom steps (positive = zoom in). */
  zoomLog(delta: number) {
    this.setTargetLog(this.targetLog + delta);
  }

  setTargetLog(log: number) {
    const c = THREE.MathUtils.clamp(log, LOG_MIN, LOG_MAX);
    if (c !== this.targetLog) {
      this.targetLog = c;
      this.onZoom?.();
    }
  }

  /* ---------------- grab (1-hand 1:1, 2-hand pinch+yaw) — reference semantics ---------------- */

  startGrab(i: 0 | 1, poseGetter: PoseGetter) {
    this.cancelTravel();
    this.grabGetter[i] = poseGetter;
    if (!this.grabActive[i]) {
      this.grabActive[i] = true;
      this.beginGrab();
      this.onGrabStart?.(this.grabActive[0] && this.grabActive[1]);
    }
  }

  endGrab(i: 0 | 1) {
    if (!this.grabActive[i]) return;
    this.grabActive[i] = false;
    this.beginGrab();
    if (!this.grabActive[0] && !this.grabActive[1]) this.onGrabEnd?.();
  }

  get grabbing(): boolean { return this.grabActive[0] || this.grabActive[1]; }

  private pose(i: 0 | 1): THREE.Matrix4 | null {
    return this.grabGetter[i]?.() ?? null;
  }

  private beginGrab() {
    const [a, b] = this.grabActive;
    if (a && b) {
      const pa = this.pose(0), pb = this.pose(1);
      if (!pa || !pb) return;
      _v1.setFromMatrixPosition(pa);
      _v2.setFromMatrixPosition(pb);
      this.d0 = Math.max(_v1.distanceTo(_v2), 0.01);
      this.s0 = this.targetScale;
      this.mid0.addVectors(_v1, _v2).multiplyScalar(0.5);
      this.p0.copy(this.tgtPos);
      this.q0.copy(this.tgtQuat);
      this.dir0.copy(_v2).sub(_v1).setY(0).normalize();
    } else if (a || b) {
      const i = a ? 0 : 1;
      const p = this.pose(i as 0 | 1);
      if (!p) return;
      this.g0[i as 0 | 1].copy(p).invert();
      this.m0.compose(this.tgtPos, this.tgtQuat, _v1.setScalar(this.targetScale));
    }
  }

  private updateGrab() {
    const [a, b] = this.grabActive;
    if (a && b) {
      const pa = this.pose(0), pb = this.pose(1);
      if (!pa || !pb) return;
      _v1.setFromMatrixPosition(pa);
      _v2.setFromMatrixPosition(pb);
      const k = THREE.MathUtils.clamp(_v1.distanceTo(_v2) / this.d0, 0.02, 50);
      const sDes = THREE.MathUtils.clamp(this.s0 * k, Math.pow(10, LOG_MIN), Math.pow(10, LOG_MAX));
      if (sDes !== this.targetScale) {
        this.targetLog = Math.log10(sDes);
        this.onZoom?.();
      }
      const mid = _v3.addVectors(_v1, _v2).multiplyScalar(0.5);
      const dir = _v2.sub(_v1).setY(0).normalize();
      const yaw = Math.atan2(_v1.copy(this.dir0).cross(dir).y, this.dir0.dot(dir));
      _q1.setFromAxisAngle(UP, yaw);
      this.tgtQuat.copy(_q1).multiply(this.q0);
      // midpoint-anchored: scale/rotate the grab-start offset about the live midpoint
      this.tgtPos.copy(mid).add(
        _v1.copy(this.p0).sub(this.mid0).applyQuaternion(_q1).multiplyScalar(sDes / this.s0),
      );
    } else if (a || b) {
      const i = a ? 0 : 1;
      const p = this.pose(i as 0 | 1);
      if (!p) return;
      // m = poseNow · poseGrabStart⁻¹ · universeAtGrabStart  (1:1 grab)
      _m1.multiplyMatrices(p, this.g0[i as 0 | 1]).multiply(this.m0);
      _m1.decompose(this.tgtPos, this.tgtQuat, _v1); // scale stays governed by targetLog
    }
  }

  /* ---------------- travel (jump / home / back) ---------------- */

  private cancelTravel() {
    if (this.travel) {
      this.travel = null;
      this.jumpState = "idle";
      this.onJumpProgress?.("idle", 0);
    }
  }

  /** Halt all eased motion right where the universe is (STOP button / Space). */
  stop() {
    this.cancelTravel();
    const u = this.app.universe;
    this.tgtPos.copy(u.position);
    this.tgtQuat.copy(u.quaternion);
    this.targetLog = this.logScale;
  }

  private dropBreadcrumb() {
    const last = this.breadcrumbs[this.breadcrumbs.length - 1];
    const moved = !last ||
      last.p.distanceTo(this.tgtPos) > 0.5 ||
      Math.abs(last.l - this.targetLog) > 0.4;
    if (moved) {
      this.breadcrumbs.push({
        p: this.tgtPos.clone(), q: this.tgtQuat.clone(), l: this.targetLog,
        label: "previous location",
      });
      if (this.breadcrumbs.length > 20) this.breadcrumbs.shift();
    }
  }

  /** Warp back to the previous pose snapshot (exact pose restore — unlike a jump,
   *  "back" returns to the precise viewpoint you left, not 0.95 m short of it). */
  goBack(): boolean {
    const crumb = this.breadcrumbs.pop();
    if (!crumb) return false;
    this.cancelTravel();
    const dur = THREE.MathUtils.clamp(
      2.6 + 0.5 * Math.abs(crumb.l - this.targetLog), 2.6, 9,
    );
    this.travel = {
      t: 0, dur,
      p0: this.tgtPos.clone(), q0: this.tgtQuat.clone(), l0: this.targetLog,
      p1: crumb.p, q1: crumb.q, l1: crumb.l,
      sel: null, label: "Back",
    };
    this.peakWorldSpeed = 0;
    this.jumpState = "warping";
    this.onJumpProgress?.("warping", 0);
    return true;
  }

  /** Warp home to the museum solar system. */
  goHome() {
    this.dropBreadcrumb();
    this.beginTravel({ p: HOME_UNI.clone(), log: HOME_LOG, label: "Solar system" });
  }

  /** Immediate travel to a selectable (B button / wrist JUMP / destination lists). */
  quickJump(target: Selectable) {
    if (this.jumpState !== "idle") return;
    this.dropBreadcrumb();
    this.beginTravel(this.destFromSelectable(target));
  }

  /** Hold-to-charge jump (desktop J / HUD button): 1.1 s charge, then fire. */
  startCharge(target: Selectable) {
    if (this.jumpState !== "idle") return;
    this.chargeTarget = target;
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

  /** Build a destination for any selectable: museum objects at HOME_LOG, everything
   *  else arrives ~0.5 m from the user with the neighbourhood visible. */
  private destFromSelectable(s: Selectable): Destination {
    const p = this.selectableUniPos(s, new THREE.Vector3());
    const museum = s.solid || s.kind === "planet" || s.kind === "moon" || s.kind === "mission";
    if (museum) return { p, log: HOME_LOG, label: s.name, sel: s };
    const here = this.universePos(_v2);
    const d = Math.max(p.distanceTo(here), 1e-6);
    const log = THREE.MathUtils.clamp(-Math.log10(d) - 0.3, LOG_MIN, LOG_MAX);
    return { p, log, label: s.name, sel: s };
  }

  private selectableUniPos(s: Selectable, out: THREE.Vector3): THREE.Vector3 {
    if (s.object) {
      s.object.getWorldPosition(out);
      return this.app.universe.worldToLocal(out);
    }
    if (s.position) return out.copy(s.position);
    return out.set(0, 0, 0);
  }

  /** Reference goTo: yaw the universe so the destination ends up ahead of the user,
   *  then ease position+scale there (orientation completes in the first 35%). */
  beginTravel(dest: Destination) {
    this.cancelTravel();
    const head = this.headWorld(new THREE.Vector3());
    const fwd = this.app.camera.getWorldDirection(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const anchor = head.clone().addScaledVector(fwd, 0.95);

    // target orientation: yaw so the destination lies ahead
    const q1 = this.tgtQuat.clone();
    const pw = this.app.universe.localToWorld(_v1.copy(dest.p));
    const v1 = pw.sub(head);
    v1.y = 0;
    if (v1.lengthSq() > 1e-8) {
      v1.normalize();
      const dy = Math.atan2(fwd.x, fwd.z) - Math.atan2(v1.x, v1.z);
      q1.premultiply(_q1.setFromAxisAngle(UP, dy));
    }
    const sc = Math.pow(10, dest.log);
    const p1 = anchor.sub(_v1.copy(dest.p).applyQuaternion(q1).multiplyScalar(sc));
    const dur = THREE.MathUtils.clamp(
      2.6 + 0.5 * Math.abs(dest.log - this.targetLog), 2.6, 9,
    );
    this.travel = {
      t: 0, dur,
      p0: this.tgtPos.clone(), q0: this.tgtQuat.clone(), l0: this.targetLog,
      p1, q1, l1: dest.log,
      sel: dest.sel ?? null, label: dest.label,
    };
    this.peakWorldSpeed = 0;
    this.jumpState = "warping";
    this.onJumpProgress?.("warping", 0);
  }

  private updateTravel(dt: number) {
    const tr = this.travel;
    if (!tr) return;
    tr.t += dt;
    const u = tr.t / tr.dur;
    const e = smoothstep5(u);                      // accelerate → cruise → brake
    const er = smoothstep5(Math.min(1, u / 0.35)); // orientation completes first
    this.tgtQuat.copy(tr.q0).slerp(tr.q1, er);
    this.tgtPos.lerpVectors(tr.p0, tr.p1, e);
    this.targetLog = tr.l0 + (tr.l1 - tr.l0) * e;
    this.onJumpProgress?.("warping", Math.min(1, u));
    if (tr.t >= tr.dur) {
      this.travel = null;
      this.jumpState = "idle";
      this.jumpCharge = 0;
      this.onJumpProgress?.("idle", 0);
      this.onArrive?.(tr.sel);
    }
  }

  /* ---------------- frame update ---------------- */

  update(dt: number, _t: number) {
    // charge → fire
    if (this.jumpState === "charging") {
      this.jumpCharge = Math.min(1, this.jumpCharge + dt / 1.1);
      this.onJumpProgress?.("charging", this.jumpCharge);
      if (this.jumpCharge >= 1 && this.chargeTarget) {
        const t = this.chargeTarget;
        this.chargeTarget = null;
        this.dropBreadcrumb();
        this.beginTravel(this.destFromSelectable(t));
      }
    }

    // inputs that steer targets (grab wins over travel, mirroring the reference)
    if (this.grabbing) this.updateGrab();
    else {
      if (this.app.mode === "desktop") this.flyThrust(dt);
      this.updateTravel(dt);
    }

    // damped easing toward targets — no velocity, no inertia, no drift
    const u = this.app.universe;
    const k = 1 - Math.exp(-dt * 6.5);
    u.position.lerp(this.tgtPos, k);
    u.quaternion.slerp(this.tgtQuat, k);
    // Snap when within float noise of the target — exponential easing is asymptotic,
    // and a residual micro-rotation about the (far-away) universe origin otherwise
    // shows up as a permanent non-zero speed reading after every jump.
    if (u.position.distanceToSquared(this.tgtPos) < 1e-10) u.position.copy(this.tgtPos);
    if (u.quaternion.angleTo(this.tgtQuat) < 1e-6) u.quaternion.copy(this.tgtQuat);
    if (Math.abs(this.targetLog - this.logScale) > 1e-6) {
      this.logScale += (this.targetLog - this.logScale) * k;
      u.scale.setScalar(this.scale);
    }

    // actual eased motion past the user (HUD / audio / vignette / FOV)
    u.updateMatrixWorld(false);
    const uni = this.universePos(_v2);
    if (dt > 1e-6) {
      const v = uni.distanceTo(this.prevUserUni) / dt; // pc/s
      this.speedSmooth += (v - this.speedSmooth) * Math.min(1, dt * 8);
      const w = v * this.scale;                        // m/s
      this.worldSpeedSmooth += (w - this.worldSpeedSmooth) * Math.min(1, dt * 8);
      if (this.travel) this.peakWorldSpeed = Math.max(this.peakWorldSpeed, this.worldSpeedSmooth);
    }
    this.prevUserUni.copy(uni);
  }
}
