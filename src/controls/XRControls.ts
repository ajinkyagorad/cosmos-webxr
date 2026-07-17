// XR controller controls: sticks, triggers, buttons, grab-drag, haptics.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { Selection } from "../scene/Selection";
import { settings } from "../ui/Settings";

interface GrabState {
  active: boolean;
  lastPos: THREE.Vector3;
}

export class XRControls implements Updatable {
  private app: App;
  private nav: Navigation;
  private selection: Selection;
  controllers: THREE.Group[] = [];
  grips: THREE.Group[] = [];
  private prevButtons: Record<string, boolean> = {};
  private snapReady = true;
  private grab: Record<"left" | "right", GrabState> = {
    left: { active: false, lastPos: new THREE.Vector3() },
    right: { active: false, lastPos: new THREE.Vector3() },
  };
  /** Ray used for XR selection (from right controller). */
  readonly raycaster = new THREE.Raycaster();
  onSelectRay: ((raycaster: THREE.Raycaster) => void) | null = null;
  /** Fired for UI hover haptics etc. */
  pulse(hand: "left" | "right", intensity: number, ms: number) {
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;
    if (!session) return;
    for (let i = 0; i < session.inputSources.length; i++) {
      const src = session.inputSources[i];
      if (src.handedness === hand && src.gamepad?.hapticActuators?.[0]) {
        src.gamepad.hapticActuators[0].pulse(THREE.MathUtils.clamp(intensity, 0, 1), ms).catch(() => {});
      }
    }
  }

  constructor(app: App, nav: Navigation, selection: Selection) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;
    for (let i = 0; i < 2; i++) {
      const c = this.app.renderer.xr.getController(i);
      const g = this.app.renderer.xr.getControllerGrip(i);
      this.controllers.push(c as unknown as THREE.Group);
      this.grips.push(g as unknown as THREE.Group);
      this.app.rig.add(c, g);
      // Simple visible laser pointer on each controller.
      const laserGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 0.35, 6);
      laserGeo.translate(0, 0, -0.175);
      laserGeo.rotateX(-Math.PI / 2);
      const laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.5 }));
      (c as unknown as THREE.Group).add(laser);
    }
  }

  private wasPressed(id: string): boolean {
    return !!this.prevButtons[id];
  }

  update(dt: number, _t: number) {
    if (this.app.mode === "desktop") return;
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;
    if (!session) return;

    const nextButtons: Record<string, boolean> = {};
    let thrust = 0, brake = 0;
    const stick = { lx: 0, ly: 0, rx: 0 };

    for (let i = 0; i < session.inputSources.length; i++) {
      const src = session.inputSources[i];
      const gp = src.gamepad;
      if (!gp) continue;
      const hand = src.handedness as "left" | "right";
      const ax = gp.axes;
      const bt = gp.buttons;
      const b = (n: number) => !!bt[n]?.pressed;
      const id = (n: number) => `${hand}:${n}`;
      nextButtons[id(0)] = b(0); nextButtons[id(1)] = b(1);
      nextButtons[id(4)] = b(4); nextButtons[id(5)] = b(5);

      if (hand === "right") {
        stick.rx = ax[2] ?? 0;
        thrust = bt[0]?.value ?? 0;
        // A = select under ray
        if (b(4) && !this.wasPressed(id(4))) {
          this.castSelectionRay("right");
          this.pulse("right", 0.3, 30);
        }
        // B = jump to selected
        if (b(5) && !this.wasPressed(id(5)) && this.selection.target) {
          this.nav.quickJump(this.selection.target);
          this.pulse("right", 0.6, 120);
        }
        this.handleGrab(src, "right", b(1), dt);
      } else if (hand === "left") {
        stick.lx = ax[2] ?? 0; stick.ly = ax[3] ?? 0;
        brake = bt[0]?.value ?? 0;
        // X = labels, Y = orbits
        if (b(4) && !this.wasPressed(id(4))) { settings.toggle("labels"); this.pulse("left", 0.3, 30); }
        if (b(5) && !this.wasPressed(id(5))) { settings.toggle("orbits"); this.pulse("left", 0.3, 30); }
        this.handleGrab(src, "left", b(1), dt);
      }
    }
    this.prevButtons = nextButtons;

    // --- Turning: right stick, smooth or snap ---
    if (Math.abs(stick.rx) > 0.25) {
      if (settings.get("snapTurn")) {
        if (this.snapReady) {
          this.app.rig.rotateY(-Math.sign(stick.rx) * THREE.MathUtils.degToRad(45));
          this.snapReady = false;
          this.pulse("right", 0.2, 20);
        }
      } else {
        this.app.rig.rotateY(-stick.rx * THREE.MathUtils.degToRad(settings.get("turnSpeed")) * dt);
      }
    } else {
      this.snapReady = true;
    }

    // --- Translation: left stick (camera-relative) + right trigger thrust ---
    const q = this.app.camera.getWorldQuaternion(new THREE.Quaternion());
    const move = new THREE.Vector3(stick.lx, 0, stick.ly);
    if (move.lengthSq() > 0.02) {
      move.applyQuaternion(q);
      this.nav.velocity.addScaledVector(move, this.nav.accel * dt * 1.5);
    }
    if (thrust > 0.05) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      this.nav.velocity.addScaledVector(fwd, this.nav.accel * thrust * dt * 2);
      // Thrust rumble ∝ acceleration.
      this.pulse("right", 0.15 + thrust * 0.35, 60);
    }
    this.nav.braking = brake > 0.3;
    // Jump charge haptic crescendo.
    if (this.nav.jumpState === "charging") {
      this.pulse("right", this.nav.jumpCharge * 0.8, 80);
    }
  }

  /** Cast the selection ray from a controller and notify. */
  castSelectionRay(hand: "left" | "right") {
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;
    if (!session) return;
    // Use the controller matching handedness via targetRay pose: approximate with controller object.
    const idx = hand === "right" ? 1 : 0;
    const c = this.controllers[idx];
    // Prefer matching by actual input source order; fallback: use first controller.
    const ctrl = c ?? this.controllers[0];
    const m = ctrl.matrixWorld;
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(new THREE.Matrix4().extractRotation(m));
    this.raycaster.ray.origin.copy(origin);
    this.raycaster.ray.direction.copy(dir);
    this.onSelectRay?.(this.raycaster);
  }

  /** Grip + pull = grab and drag the universe (implemented as inverse rig motion). */
  private handleGrab(src: XRInputSource, hand: "left" | "right", squeezed: boolean, _dt: number) {
    const g = this.grab[hand];
    const idx = hand === "right" ? 1 : 0;
    const ctrl = this.controllers[idx];
    if (!ctrl) return;
    const pos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
    if (squeezed) {
      if (!g.active) {
        g.active = true;
        g.lastPos.copy(pos);
      } else {
        const delta = pos.clone().sub(g.lastPos);
        // Dragging the universe: move rig opposite to controller motion (in rig frame).
        const rigQ = this.app.rig.getWorldQuaternion(new THREE.Quaternion()).invert();
        delta.applyQuaternion(rigQ);
        this.app.rig.position.sub(delta);
        g.lastPos.copy(pos);
      }
    } else {
      g.active = false;
    }
    void src;
  }
}
