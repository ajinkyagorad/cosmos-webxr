// Hand-tracking controls: pinch select, two-pinch pull-to-fly, open-palm brake.
// Degrades gracefully — when no hand is tracked, everything here is a no-op.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { XRControls } from "./XRControls";

interface HandState {
  hand: THREE.Group | null;
  pinching: boolean;
  pinchStart: THREE.Vector3;
  lastPinchPos: THREE.Vector3;
  palmBraking: boolean;
}

export class HandControls implements Updatable {
  private app: App;
  private nav: Navigation;
  private xr: XRControls;
  private states: [HandState, HandState] = [
    { hand: null, pinching: false, pinchStart: new THREE.Vector3(), lastPinchPos: new THREE.Vector3(), palmBraking: false },
    { hand: null, pinching: false, pinchStart: new THREE.Vector3(), lastPinchPos: new THREE.Vector3(), palmBraking: false },
  ];
  private twoPinchLast = 0;
  onPinchSelect: ((origin: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;

  constructor(app: App, nav: Navigation, xr: XRControls) {
    this.app = app;
    this.nav = nav;
    this.xr = xr;
    for (let i = 0; i < 2; i++) {
      const h = this.app.renderer.xr.getHand(i) as unknown as THREE.Group;
      this.states[i].hand = h;
      this.app.rig.add(h);
    }
  }

  private jointWorld(hand: THREE.Group, name: string, out: THREE.Vector3): boolean {
    const joints = (hand as unknown as { joints?: Record<string, THREE.Object3D> }).joints;
    const j = joints?.[name];
    if (!j) return false;
    j.getWorldPosition(out);
    return true;
  }

  private isPinching(hand: THREE.Group): { pinching: boolean; tip: THREE.Vector3; thumb: THREE.Vector3 } {
    const tip = new THREE.Vector3(), thumb = new THREE.Vector3();
    if (!this.jointWorld(hand, "index-finger-tip", tip) || !this.jointWorld(hand, "thumb-tip", thumb)) {
      return { pinching: false, tip, thumb };
    }
    return { pinching: tip.distanceTo(thumb) < 0.022, tip, thumb };
  }

  private isOpenPalm(hand: THREE.Group): boolean {
    // Open palm: all fingertips far from palm center.
    const palm = new THREE.Vector3();
    if (!this.jointWorld(hand, "middle-finger-metacarpal", palm)) return false;
    let open = 0;
    for (const j of ["index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"]) {
      const p = new THREE.Vector3();
      if (this.jointWorld(hand, j, p) && p.distanceTo(palm) > 0.12) open++;
    }
    return open >= 3;
  }

  update(_dt: number, _t: number) {
    if (this.app.mode === "desktop") return;
    const pinchInfo = this.states.map((s) => (s.hand ? this.isPinching(s.hand) : null));
    const anyPinch = pinchInfo.filter((p) => p?.pinching);

    // --- Single pinch start → ray select ---
    this.states.forEach((s, i) => {
      const p = pinchInfo[i];
      if (!p || !s.hand) return;
      if (p.pinching && !s.pinching) {
        s.pinching = true;
        s.pinchStart.copy(p.tip);
        // Ray from knuckles through pinch point.
        const knuckle = new THREE.Vector3();
        this.jointWorld(s.hand, "index-finger-phalanx-proximal", knuckle);
        const dir = p.tip.clone().sub(knuckle).normalize();
        this.onPinchSelect?.(p.tip, dir);
        this.xr.pulse(i === 1 ? "right" : "left", 0.25, 25);
      } else if (!p.pinching) {
        s.pinching = false;
      }
      s.lastPinchPos.copy(p.tip);
    });

    // --- Two-pinch pull = fly (pull space toward you) ---
    if (anyPinch.length === 2 && pinchInfo[0] && pinchInfo[1]) {
      const mid = pinchInfo[0]!.tip.clone().add(pinchInfo[1]!.tip).multiplyScalar(0.5);
      if (this.twoPinchLast > 0) {
        const pull = mid.z - this.twoPinchLast; // pulling toward user = +z in head space
        const headQ = this.app.camera.getWorldQuaternion(new THREE.Quaternion());
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ);
        // Speed ∝ pull velocity.
        this.nav.velocity.addScaledVector(fwd, -pull * 14);
      }
      this.twoPinchLast = mid.z;
    } else {
      this.twoPinchLast = 0;
    }

    // --- Open palm push = gentle brake ---
    let palmBrake = false;
    this.states.forEach((s) => {
      if (s.hand && this.isOpenPalm(s.hand)) palmBrake = true;
    });
    if (palmBrake && !this.states[0].palmBraking) this.xr.pulse("left", 0.2, 30);
    this.states[0].palmBraking = palmBrake;
    if (palmBrake) this.nav.braking = true;
  }
}
